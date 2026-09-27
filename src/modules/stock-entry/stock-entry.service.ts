import { Injectable } from '@nestjs/common';
import { Prisma, PurchaseInvoice } from '@prisma/client';

import { buildDocumentKey } from './document-key';
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { UploadConfirmationResponseDto } from './dto/upload-confirmation-response.dto';
import { UploadUrlResponseDto } from './dto/upload-url-response.dto';
import { ExtractionService } from './extraction.service';
import { MAX_FILE_BYTES_SIZE, PRESIGNED_TTL_MS } from './stock-entry.constants';
import { StockEntryRepository } from './stock-entry.repository';
import { UniqueConstraintError } from '../../infra/prisma/prisma-errors';
import { DocumentStorage } from '../../infra/storage';
import { DomainError } from '../../shared/errors/domain-error';

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
    if (dto.fileBytesSize > MAX_FILE_BYTES_SIZE) throw this.fileTooLarge(dto);

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
    if (!invoice) throw this.notFound(purchaseInvoiceId);
    if (invoice.status !== 'DRAFT') throw this.notEditable(invoice);

    const key = buildDocumentKey(userId, purchaseInvoiceId);
    const stored = await this.documentStorage.headDocument(key);
    if (!stored) throw this.uploadNotFinished(purchaseInvoiceId);

    // The policy pinned type and size to what the app declared, so a
    // divergence here means the object in the bucket is not the one this
    // invoice was signed for — the app reissues the presigned POST and resends.
    if (invoice.fileMimeType && stored.contentType !== invoice.fileMimeType) {
      throw this.uploadMismatch(
        'contentType',
        invoice.fileMimeType,
        stored.contentType,
      );
    }
    if (
      invoice.fileBytesSize !== null &&
      stored.contentLength !== invoice.fileBytesSize
    ) {
      throw this.uploadMismatch(
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
      if (this.isFileHashViolation(error)) throw this.duplicateFile();

      // The primary key collided: either we raced against our own retry, or the
      // app sent an id that belongs to someone else.
      const raced = await this.stockEntryRepository.findByIdAndUser(
        purchaseInvoiceId,
        userId,
      );
      if (!raced) throw this.notFound(purchaseInvoiceId);

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
      throw this.notEditable(invoice);
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
        throw this.duplicateFile();
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

  /** 404 and not 403: confirming that the invoice exists already leaks it. */
  private notFound(id: string) {
    return new DomainError(
      'NOT_FOUND',
      'INVOICE_NOT_FOUND',
      `Purchase invoice ${id} not found`,
      { id },
    );
  }

  private fileTooLarge(dto: CreateUploadUrlDto) {
    return new DomainError(
      'PAYLOAD_TOO_LARGE',
      'INVOICE_FILE_TOO_LARGE',
      `The file exceeds the ${MAX_FILE_BYTES_SIZE} byte limit`,
      {
        fileBytesSize: dto.fileBytesSize,
        maxFileBytesSize: MAX_FILE_BYTES_SIZE,
      },
    );
  }

  private uploadNotFinished(id: string) {
    return new DomainError(
      'CONFLICT',
      'INVOICE_UPLOAD_NOT_FINISHED',
      'No document was found for this purchase invoice',
      { id },
    );
  }

  private notEditable(invoice: PurchaseInvoice) {
    return new DomainError(
      'CONFLICT',
      'INVOICE_NOT_EDITABLE',
      'The purchase invoice no longer accepts a document',
      {
        id: invoice.id,
        status: invoice.status,
        extractionStatus: invoice.extractionStatus,
      },
    );
  }

  private uploadMismatch(
    field: 'contentType' | 'contentLength',
    declared: string | number,
    stored?: string | number,
  ) {
    return new DomainError(
      'CONFLICT',
      'INVOICE_UPLOAD_MISMATCH',
      'The stored document does not match what was declared',
      { field, declared, stored: stored ?? null },
    );
  }

  private duplicateFile() {
    return new DomainError(
      'CONFLICT',
      'INVOICE_FILE_DUPLICATED',
      'This file was already uploaded',
    );
  }
}

function isPhoto(dto: CreateUploadUrlDto): boolean {
  return dto.fileMimeType === 'image/jpeg';
}
