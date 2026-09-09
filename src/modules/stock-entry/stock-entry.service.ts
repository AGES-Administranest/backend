import { Injectable } from '@nestjs/common';

import { buildDocumentKey } from './document-key';
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { UploadUrlResponseDto } from './dto/upload-url-response.dto';
import { MAX_FILE_BYTES_SIZE, PRESIGNED_TTL_MS } from './stock-entry.constants';
import { StockEntryRepository } from './stock-entry.repository';
import { UniqueConstraintError } from '../../infra/prisma/prisma-errors';
import { DocumentStorage } from '../../infra/storage';
import { DomainError } from '../../shared/errors/domain-error';
import { UsersService } from '../users';

/**
 * Written against today's schema, before the US10 migration. Every comment
 * tagged `AFTER MIGRATION` is a rule the doc requires but that has no column to
 * live in yet — without them this route reissues a presigned POST for an
 * invoice that is already confirmed.
 */
@Injectable()
export class StockEntryService {
  constructor(
    private readonly stockEntryRepository: StockEntryRepository,
    private readonly usersService: UsersService,
    private readonly documentStorage: DocumentStorage,
  ) {}

  async createUploadUrl(
    cognitoSub: string,
    purchaseInvoiceId: string,
    dto: CreateUploadUrlDto,
  ): Promise<UploadUrlResponseDto> {
    const user = await this.usersService.findByCognitoSub(cognitoSub);
    if (!user) throw this.notProvisioned();

    // Before signing anything (§7.3): the presigned POST pins
    // `content-length-range` to this exact size, so past the limit S3 would
    // reject the upload itself — late, and with an error the app cannot read.
    if (dto.fileBytesSize > MAX_FILE_BYTES_SIZE) throw this.fileTooLarge(dto);

    const key = buildDocumentKey(user.id, purchaseInvoiceId);
    await this.saveDocumentMetadata(user.id, purchaseInvoiceId, key, dto);

    // AFTER MIGRATION: stamp `upload_requested_at`, which is what the sweep
    // uses to find drafts whose upload never arrived.

    return this.createPresignedPost(key, dto);
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

  private duplicateFile() {
    return new DomainError(
      'CONFLICT',
      'PEDIDO_ARQUIVO_DUPLICADO',
      'This file was already uploaded',
    );
  }

  private notProvisioned() {
    return new DomainError(
      'NOT_FOUND',
      'USUARIO_NAO_PROVISIONADO',
      'The authenticated user has no local mirror yet. Call POST /auth/session first.',
    );
  }
}
