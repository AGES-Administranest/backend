import { Injectable } from '@nestjs/common';

import { buildDocumentKey } from './document-key';
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { UploadConfirmationResponseDto } from './dto/upload-confirmation-response.dto';
import { UploadUrlResponseDto } from './dto/upload-url-response.dto';
import { MAX_FILE_BYTES_SIZE, PRESIGNED_TTL_MS } from './stock-entry.constants';
import { StockEntryRepository } from './stock-entry.repository';
import { UniqueConstraintError } from '../../infra/prisma/prisma-errors';
import { DocumentStorage } from '../../infra/storage';
import { DomainError } from '../../shared/errors/domain-error';

/**
 * Written against today's schema, before the US10 migration. Every comment
 * tagged `AFTER MIGRATION` is a rule that has no column to live in yet —
 * without them this route reissues a presigned POST for an invoice that is
 * already confirmed.
 */
@Injectable()
export class StockEntryService {
  constructor(
    private readonly stockEntryRepository: StockEntryRepository,
    private readonly documentStorage: DocumentStorage,
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

    // AFTER MIGRATION: stamp `upload_requested_at`, which is what the sweep
    // uses to find drafts whose upload never arrived.

    return this.createPresignedPost(key, dto);
  }

  /**
   * The app says the upload finished and the API checks the bucket instead of
   * believing it. Without this an invoice reaches the review screen with no
   * document behind it, and nobody finds out until someone opens it months
   * later.
   *
   * AFTER MIGRATION: this is `POST /extrair` — same HeadObject, plus comparing
   * `ContentLength` against the declared `content_length`, stamping
   * `file_key` and `uploaded_at`, and enqueuing the extraction job. While the
   * extraction runs in the app, verifying and answering is all it does.
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

    const key = buildDocumentKey(userId, purchaseInvoiceId);
    const stored = await this.documentStorage.headDocument(key);
    if (!stored) throw this.uploadNotFinished(purchaseInvoiceId);

    // The policy pinned the type to what the app declared, so a divergence here
    // means the object in the bucket is not the one this invoice was signed
    // for — the app reissues the presigned POST and resends.
    if (invoice.fileMimeType && stored.contentType !== invoice.fileMimeType) {
      throw this.uploadMismatch(invoice.fileMimeType, stored.contentType);
    }

    return {
      contentLength: stored.contentLength,
      contentType: stored.contentType ?? '',
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
      // AFTER MIGRATION: 409 `PEDIDO_NAO_EDITAVEL` when `status` is not DRAFT,
      // or when `extraction_status` is PROCESSING or SUCCESS.
      await this.updateDocument(purchaseInvoiceId, key, dto);
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

      await this.updateDocument(purchaseInvoiceId, key, dto);
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
      // AFTER MIGRATION: this becomes `fileKey`, and `status: DRAFT`,
      // `extractionStatus: PENDING`, `fileName` and `contentLength` join it.
      fileUrl: key,
      fileMimeType: dto.fileMimeType,
      fileHash: dto.fileHash,
      updatedAt: new Date(),
    });
  }

  private async updateDocument(
    purchaseInvoiceId: string,
    key: string,
    dto: CreateUploadUrlDto,
  ) {
    try {
      // Document metadata only: replacing the whole row would wipe the supplier,
      // the date and the line items fixed between one issue and the next.
      return await this.stockEntryRepository.update(purchaseInvoiceId, {
        fileUrl: key,
        fileMimeType: dto.fileMimeType,
        fileHash: dto.fileHash,
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
      'PEDIDO_NAO_ENCONTRADO',
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
      'PEDIDO_UPLOAD_NAO_CONCLUIDO',
      'No document was found for this purchase invoice',
      { id },
    );
  }

  private uploadMismatch(declared: string, stored?: string) {
    return new DomainError(
      'CONFLICT',
      'PEDIDO_UPLOAD_DIVERGENTE',
      'The stored document does not match what was declared',
      { declared, stored: stored ?? null },
    );
  }

  private duplicateFile() {
    return new DomainError(
      'CONFLICT',
      'PEDIDO_ARQUIVO_DUPLICADO',
      'This file was already uploaded',
    );
  }
}
