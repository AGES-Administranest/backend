import { ServiceInvoice } from '@prisma/client';

import { SERVICE_INVOICE_UPLOAD } from './service-invoices.constants';
import { DomainError } from '../../shared/errors/domain-error';

/** 404 and not 403: confirming that the note exists already leaks it. */
export function serviceInvoiceNotFound(id: string): DomainError {
  return new DomainError(
    'NOT_FOUND',
    'SERVICE_INVOICE_NOT_FOUND',
    `Service invoice ${id} not found`,
    { id },
  );
}

export function serviceInvoiceNotEditable(
  invoice: ServiceInvoice,
): DomainError {
  return new DomainError(
    'CONFLICT',
    'SERVICE_INVOICE_NOT_EDITABLE',
    'The service invoice can no longer be changed',
    {
      id: invoice.id,
      status: invoice.status,
      extractionStatus: invoice.extractionStatus,
    },
  );
}

export function fileTooLarge(fileBytesSize: number): DomainError {
  const { maxBytesSize } = SERVICE_INVOICE_UPLOAD;
  return new DomainError(
    'PAYLOAD_TOO_LARGE',
    'SERVICE_INVOICE_FILE_TOO_LARGE',
    `The file exceeds the ${maxBytesSize} byte limit`,
    { fileBytesSize, maxFileBytesSize: maxBytesSize },
  );
}

/** Carries the note already holding the file, for the app to open it. */
export function fileDuplicated(serviceInvoiceId?: string): DomainError {
  return new DomainError(
    'CONFLICT',
    'SERVICE_INVOICE_FILE_DUPLICATED',
    'This file was already uploaded',
    serviceInvoiceId ? { serviceInvoiceId } : undefined,
  );
}

export function uploadNotFinished(id: string): DomainError {
  return new DomainError(
    'CONFLICT',
    'SERVICE_INVOICE_UPLOAD_NOT_FINISHED',
    'No document was found for this service invoice',
    { id },
  );
}

export function uploadMismatch(
  field: 'contentType' | 'contentLength',
  declared: string | number,
  stored?: string | number,
): DomainError {
  return new DomainError(
    'CONFLICT',
    'SERVICE_INVOICE_UPLOAD_MISMATCH',
    'The stored document does not match what was declared',
    { field, declared, stored: stored ?? null },
  );
}
