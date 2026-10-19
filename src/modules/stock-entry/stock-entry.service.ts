import { Injectable } from '@nestjs/common';
import { Prisma, PurchaseInvoice } from '@prisma/client';

import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { UploadConfirmationResponseDto } from './dto/upload-confirmation-response.dto';
import { UploadUrlResponseDto } from './dto/upload-url-response.dto';
import { ExtractionService } from './extraction.service';
import { PURCHASE_INVOICE_UPLOAD } from './stock-entry.constants';
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
import {
  documentKey,
  DocumentUploads,
  StoredDocument,
  UploadCheck,
} from '../../infra/storage';

@Injectable()
export class StockEntryService {
  constructor(
    private readonly stockEntryRepository: StockEntryRepository,
    private readonly documentUploads: DocumentUploads,
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
    if (dto.fileBytesSize > PURCHASE_INVOICE_UPLOAD.maxBytesSize) {
      throw fileTooLarge(dto.fileBytesSize);
    }

    const key = documentKey(userId, 'purchase-invoices', purchaseInvoiceId);
    await this.saveDocumentMetadata(userId, purchaseInvoiceId, key, dto);

    return this.documentUploads.signUpload(
      key,
      { mimeType: dto.fileMimeType, bytesSize: dto.fileBytesSize },
      PURCHASE_INVOICE_UPLOAD,
    );
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

    const check = await this.documentUploads.verifyUpload(
      documentKey(userId, 'purchase-invoices', purchaseInvoiceId),
      { mimeType: invoice.fileMimeType, bytesSize: invoice.fileBytesSize },
    );
    // On a mismatch the app reissues the presigned POST and resends.
    const stored = storedDocumentOf(check, purchaseInvoiceId);

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

  private isFileHashViolation(error: UniqueConstraintError) {
    return error.fields.some(field => field.includes('file_hash'));
  }

  private async fileDuplicatedFor(userId: string, fileHash: string) {
    return fileDuplicated(
      await this.stockEntryRepository.findIdByFileHash(userId, fileHash),
    );
  }
}

function storedDocumentOf(
  check: UploadCheck,
  purchaseInvoiceId: string,
): StoredDocument {
  switch (check.status) {
    case 'missing':
      throw uploadNotFinished(purchaseInvoiceId);
    case 'mismatch':
      throw uploadMismatch(check.field, check.declared, check.stored);
    case 'stored':
      return check.document;
  }
}

function isPhoto(dto: CreateUploadUrlDto): boolean {
  return dto.fileMimeType === 'image/jpeg';
}
