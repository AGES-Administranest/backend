import { Injectable } from '@nestjs/common';
import { Prisma, ServiceInvoice } from '@prisma/client';

import { CreateServiceInvoiceUploadUrlDto } from './dto/create-upload-url.dto';
import { ServiceInvoiceUploadConfirmationDto } from './dto/upload-confirmation-response.dto';
import { ServiceInvoiceUploadUrlResponseDto } from './dto/upload-url-response.dto';
import { NfseReadingService } from './nfse-reading.service';
import { toReview } from './service-invoice.mapper';
import { SERVICE_INVOICE_UPLOAD } from './service-invoices.constants';
import {
  fileDuplicated,
  fileTooLarge,
  serviceInvoiceNotEditable,
  serviceInvoiceNotFound,
  uploadMismatch,
  uploadNotFinished,
} from './service-invoices.errors';
import { ServiceInvoicesRepository } from './service-invoices.repository';
import { UniqueConstraintError } from '../../infra/prisma/prisma-errors';
import {
  documentKey,
  DocumentUploads,
  StoredDocument,
  UploadCheck,
} from '../../infra/storage';

/** The file of an NFSe: signing its upload, then checking and reading it. */
@Injectable()
export class ServiceInvoiceUploadService {
  constructor(
    private readonly repository: ServiceInvoicesRepository,
    private readonly documentUploads: DocumentUploads,
    private readonly nfseReadingService: NfseReadingService,
  ) {}

  /** `userId` is the local id the guard resolved from the token, never the body. */
  async createUploadUrl(
    userId: string,
    serviceInvoiceId: string,
    dto: CreateServiceInvoiceUploadUrlDto,
  ): Promise<ServiceInvoiceUploadUrlResponseDto> {
    // Past the limit S3 would reject the upload itself, late and with an error
    // the app cannot read.
    if (dto.fileBytesSize > SERVICE_INVOICE_UPLOAD.maxBytesSize) {
      throw fileTooLarge(dto.fileBytesSize);
    }

    const key = documentKey(userId, 'service-invoices', serviceInvoiceId);
    await this.saveDocumentMetadata(userId, serviceInvoiceId, key, dto);

    return this.documentUploads.signUpload(
      key,
      { mimeType: dto.fileMimeType, bytesSize: dto.fileBytesSize },
      SERVICE_INVOICE_UPLOAD,
    );
  }

  /**
   * The app says the upload finished and the API checks the bucket instead of
   * believing it, then reads the PDF. The answer is what the review starts from.
   */
  async confirmUpload(
    userId: string,
    serviceInvoiceId: string,
  ): Promise<ServiceInvoiceUploadConfirmationDto> {
    const invoice = await this.repository.findByIdAndUser(
      serviceInvoiceId,
      userId,
    );
    if (!invoice) throw serviceInvoiceNotFound(serviceInvoiceId);
    if (invoice.status !== 'DRAFT') throw serviceInvoiceNotEditable(invoice);

    const check = await this.documentUploads.verifyUpload(
      documentKey(userId, 'service-invoices', serviceInvoiceId),
      { mimeType: invoice.fileMimeType, bytesSize: invoice.fileBytesSize },
    );
    // On a mismatch the app reissues the presigned POST and resends.
    const stored = storedDocumentOf(check, serviceInvoiceId);

    const uploaded = await this.repository.update(serviceInvoiceId, {
      uploadedAt: new Date(),
    });
    const current = await this.nfseReadingService.run(uploaded);

    return {
      contentLength: stored.contentLength,
      contentType: stored.contentType ?? '',
      review: toReview(current),
    };
  }

  private async saveDocumentMetadata(
    userId: string,
    serviceInvoiceId: string,
    key: string,
    dto: CreateServiceInvoiceUploadUrlDto,
  ): Promise<void> {
    const existing = await this.repository.findByIdAndUser(
      serviceInvoiceId,
      userId,
    );
    if (existing) {
      await this.replaceDocument(existing, key, dto);
      return;
    }

    try {
      await this.repository.create({
        id: serviceInvoiceId,
        userId,
        ...documentFields(key, dto),
        updatedAt: new Date(),
      });
    } catch (error) {
      if (!(error instanceof UniqueConstraintError)) throw error;
      if (isFileHashViolation(error)) {
        throw await this.fileDuplicatedFor(userId, dto.fileHash);
      }

      // The primary key collided: either we raced against our own retry, or the
      // app sent an id that belongs to someone else.
      const raced = await this.repository.findByIdAndUser(
        serviceInvoiceId,
        userId,
      );
      if (!raced) throw serviceInvoiceNotFound(serviceInvoiceId);

      await this.replaceDocument(raced, key, dto);
    }
  }

  private async replaceDocument(
    invoice: ServiceInvoice,
    key: string,
    dto: CreateServiceInvoiceUploadUrlDto,
  ): Promise<void> {
    // Replacing a file already read would leave the review showing what
    // another document said.
    const readingStarted =
      invoice.extractionStatus === 'PROCESSING' ||
      invoice.extractionStatus === 'SUCCESS';
    if (invoice.status !== 'DRAFT' || readingStarted) {
      throw serviceInvoiceNotEditable(invoice);
    }

    try {
      // Document metadata only: the review fields fixed so far stay.
      await this.repository.update(invoice.id, {
        ...documentFields(key, dto),
        uploadedAt: null,
        // A failed reading was about the file being replaced.
        ...(invoice.extractionStatus === 'FAILED' && {
          extractionStatus: 'PENDING',
          failureReason: null,
          rawExtraction: Prisma.DbNull,
        }),
      });
    } catch (error) {
      if (
        error instanceof UniqueConstraintError &&
        isFileHashViolation(error)
      ) {
        throw await this.fileDuplicatedFor(invoice.userId, dto.fileHash);
      }
      throw error;
    }
  }

  private async fileDuplicatedFor(userId: string, fileHash: string) {
    return fileDuplicated(
      await this.repository.findIdByFileHash(userId, fileHash),
    );
  }
}

function documentFields(key: string, dto: CreateServiceInvoiceUploadUrlDto) {
  return {
    fileUrl: key,
    fileName: dto.filename,
    fileMimeType: dto.fileMimeType,
    fileBytesSize: dto.fileBytesSize,
    fileHash: dto.fileHash,
    uploadRequestedAt: new Date(),
  };
}

function isFileHashViolation(error: UniqueConstraintError): boolean {
  return error.fields.some(field => field.includes('file_hash'));
}

function storedDocumentOf(
  check: UploadCheck,
  serviceInvoiceId: string,
): StoredDocument {
  switch (check.status) {
    case 'missing':
      throw uploadNotFinished(serviceInvoiceId);
    case 'mismatch':
      throw uploadMismatch(check.field, check.declared, check.stored);
    case 'stored':
      return check.document;
  }
}
