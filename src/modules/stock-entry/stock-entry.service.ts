import { Injectable } from '@nestjs/common';
import { Prisma, PurchaseInvoice } from '@prisma/client';

import { buildDocumentKey } from './document-key';
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { UploadConfirmationResponseDto } from './dto/upload-confirmation-response.dto';
import { UploadUrlResponseDto } from './dto/upload-url-response.dto';
import { ExtractionService } from './extraction.service';
import { MAX_FILE_BYTES_SIZE, PRESIGNED_TTL_MS } from './stock-entry.constants';
import {
  fileDuplicated,
  fileTooLarge,
  invoiceNotEditable,
  invoiceNotFound,
  uploadMismatch,
  uploadNotFinished,
} from './stock-entry.errors';
import { StockEntryRepository } from './stock-entry.repository';
import { UniqueConstraintError } from '../../infra/prisma/prisma-errors';
import { DocumentStorage } from '../../infra/storage';

@Injectable()
export class StockEntryService {
  constructor(
    private readonly stockEntryRepository: StockEntryRepository,
    private readonly documentStorage: DocumentStorage,
    private readonly extractionService: ExtractionService,
  ) {}

  /** `userId` is the local id the guard resolved from the token, never the body. */
  async createUploadUrl(
    userId: string,
    purchaseInvoiceId: string,
    dto: CreateUploadUrlDto,
  ): Promise<UploadUrlResponseDto> {
    // Before signing anything: the presigned POST pins `content-length-range`
    // to this exact size, so past the limit S3 would reject the upload itself —
    // late, and with an error the app cannot read.
    if (dto.fileBytesSize > MAX_FILE_BYTES_SIZE) {
      throw fileTooLarge(dto.fileBytesSize);
    }

    const key = buildDocumentKey(userId, purchaseInvoiceId);
    await this.saveDocumentMetadata(userId, purchaseInvoiceId, key, dto);

    return this.createPresignedPost(key, dto);
  }

  /**
   * The app says the upload finished and the API checks the bucket instead of
   * believing it. Without this an invoice reaches the review screen with no
   * document behind it, and nobody finds out until someone opens it months
   * later. Then the PDF is read and matched against the catalog, and the
   * answer carries what the review screen starts from.
   */
  async confirmUpload(
    userId: string,
    purchaseInvoiceId: string,
  ): Promise<UploadConfirmationResponseDto> {
    const invoice = await this.stockEntryRepository.findByIdAndUser(
      purchaseInvoiceId,
      userId,
    );
    if (!invoice) throw invoiceNotFound(purchaseInvoiceId);
    if (invoice.status !== 'DRAFT') throw invoiceNotEditable(invoice);

    const key = buildDocumentKey(userId, purchaseInvoiceId);
    const stored = await this.documentStorage.headDocument(key);
    if (!stored) throw uploadNotFinished(purchaseInvoiceId);

    // The policy pinned type and size to what the app declared, so a
    // divergence here means the object in the bucket is not the one this
    // invoice was signed for — the app reissues the presigned POST and resends.
    if (invoice.fileMimeType && stored.contentType !== invoice.fileMimeType) {
      throw uploadMismatch(
        'contentType',
        invoice.fileMimeType,
        stored.contentType,
      );
    }
    if (
      invoice.fileBytesSize !== null &&
      stored.contentLength !== invoice.fileBytesSize
    ) {
      throw uploadMismatch(
        'contentLength',
        invoice.fileBytesSize,
        stored.contentLength,
      );
    }

    const uploaded = await this.stockEntryRepository.update(purchaseInvoiceId, {
      uploadedAt: new Date(),
    });
    const current = await this.extractionService.run(uploaded);

    return {
      contentLength: stored.contentLength,
      contentType: stored.contentType ?? '',
      extraction: this.extractionService.view(current),
    };
  }

  private async saveDocumentMetadata(
    userId: string,
    purchaseInvoiceId: string,
    key: string,
    dto: CreateUploadUrlDto,
  ): Promise<void> {
    const existing = await this.stockEntryRepository.findByIdAndUser(
      purchaseInvoiceId,
      userId,
    );

    if (existing) {
      await this.updateDocument(existing, key, dto);
      return;
    }

    try {
      await this.createDraft(userId, purchaseInvoiceId, key, dto);
    } catch (error) {
      if (!(error instanceof UniqueConstraintError)) throw error;
      if (this.isFileHashViolation(error)) {
        throw await this.fileDuplicatedFor(userId, dto.fileHash);
      }

      // The primary key collided: either we raced against our own retry, or the
      // app sent an id that belongs to someone else.
      const raced = await this.stockEntryRepository.findByIdAndUser(
        purchaseInvoiceId,
        userId,
      );
      if (!raced) throw invoiceNotFound(purchaseInvoiceId);

      await this.updateDocument(raced, key, dto);
    }
  }

  private createDraft(
    userId: string,
    purchaseInvoiceId: string,
    key: string,
    dto: CreateUploadUrlDto,
  ) {
    return this.stockEntryRepository.create({
      id: purchaseInvoiceId,
      userId,
      ...this.documentFields(key, dto),
      ...(isPhoto(dto) && { extractionStatus: 'MANUAL' as const }),
      updatedAt: new Date(),
    });
  }

  private async updateDocument(
    invoice: PurchaseInvoice,
    key: string,
    dto: CreateUploadUrlDto,
  ) {
    // Replacing a file already read would leave the review showing what
    // another document said.
    const extractionStarted =
      invoice.extractionStatus === 'PROCESSING' ||
      invoice.extractionStatus === 'SUCCESS';
    if (invoice.status !== 'DRAFT' || extractionStarted) {
      throw invoiceNotEditable(invoice);
    }

    try {
      // Document metadata only: replacing the whole row would wipe the supplier,
      // the date and the line items fixed between one issue and the next.
      return await this.stockEntryRepository.update(invoice.id, {
        ...this.documentFields(key, dto),
        uploadedAt: null,
        ...this.readingFor(invoice, dto),
      });
    } catch (error) {
      if (
        error instanceof UniqueConstraintError &&
        this.isFileHashViolation(error)
      ) {
        throw await this.fileDuplicatedFor(invoice.userId, dto.fileHash);
      }
      throw error;
    }
  }

  /**
   * A photo is never read: it is the receipt of a manual entry (US10 §1.1). A
   * failed reading was about the file being replaced (the app's "swap for a
   * PDF with text"), so the new one waits for its own.
   */
  private readingFor(
    invoice: PurchaseInvoice,
    dto: CreateUploadUrlDto,
  ): Prisma.PurchaseInvoiceUncheckedUpdateInput {
    const reset = { failureReason: null, rawExtraction: Prisma.DbNull };
    if (isPhoto(dto)) return { extractionStatus: 'MANUAL', ...reset };
    if (invoice.extractionStatus === 'FAILED') {
      return { extractionStatus: 'PENDING', ...reset };
    }
    return {};
  }

  /**
   * `uploadRequestedAt` is what the sweep uses to find drafts whose upload
   * never arrived.
   */
  private documentFields(key: string, dto: CreateUploadUrlDto) {
    return {
      fileUrl: key,
      fileName: dto.filename,
      fileMimeType: dto.fileMimeType,
      fileBytesSize: dto.fileBytesSize,
      fileHash: dto.fileHash,
      uploadRequestedAt: new Date(),
    };
  }

  private createPresignedPost(
    key: string,
    dto: CreateUploadUrlDto,
  ): Promise<UploadUrlResponseDto> {
    return this.documentStorage.createPresignedPost({
      key,
      contentType: dto.fileMimeType,
      contentLength: dto.fileBytesSize,
      expiresInMs: PRESIGNED_TTL_MS,
    });
  }

  private isFileHashViolation(error: UniqueConstraintError) {
    return error.fields.some(field => field.includes('file_hash'));
  }

  private async fileDuplicatedFor(userId: string, fileHash: string) {
    return fileDuplicated(
      await this.stockEntryRepository.findIdByFileHash(userId, fileHash),
    );
  }
}

function isPhoto(dto: CreateUploadUrlDto): boolean {
  return dto.fileMimeType === 'image/jpeg';
}
