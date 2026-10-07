import { PurchaseInvoice } from '@prisma/client';

import { MAX_FILE_BYTES_SIZE } from './stock-entry.constants';
import { DomainError } from '../../shared/errors/domain-error';

/** 404 and not 403: confirming that the invoice exists already leaks it. */
export function invoiceNotFound(id: string): DomainError {
  return new DomainError(
    'NOT_FOUND',
    'INVOICE_NOT_FOUND',
    `Purchase invoice ${id} not found`,
    { id },
  );
}

export function invoiceNotReady(id: string): DomainError {
  return new DomainError(
    'INVALID_INPUT',
    'INVOICE_NOT_READY',
    'The invoice needs a total greater than zero and an issue date',
    { id },
  );
}

export function invoiceNotEditable(invoice: PurchaseInvoice): DomainError {
  return new DomainError(
    'CONFLICT',
    'INVOICE_NOT_EDITABLE',
    'The purchase invoice can no longer be changed',
    {
      id: invoice.id,
      status: invoice.status,
      extractionStatus: invoice.extractionStatus,
    },
  );
}

export function fileTooLarge(fileBytesSize: number): DomainError {
  return new DomainError(
    'PAYLOAD_TOO_LARGE',
    'INVOICE_FILE_TOO_LARGE',
    `The file exceeds the ${MAX_FILE_BYTES_SIZE} byte limit`,
    { fileBytesSize, maxFileBytesSize: MAX_FILE_BYTES_SIZE },
  );
}

/** Carries the invoice already holding the file, for the app to open it. */
export function fileDuplicated(purchaseInvoiceId?: string): DomainError {
  return new DomainError(
    'CONFLICT',
    'INVOICE_FILE_DUPLICATED',
    'This file was already uploaded',
    purchaseInvoiceId ? { purchaseInvoiceId } : undefined,
  );
}

export function uploadNotFinished(id: string): DomainError {
  return new DomainError(
    'CONFLICT',
    'INVOICE_UPLOAD_NOT_FINISHED',
    'No document was found for this purchase invoice',
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
    'INVOICE_UPLOAD_MISMATCH',
    'The stored document does not match what was declared',
    { field, declared, stored: stored ?? null },
  );
}

/** Someone else's item is reported exactly as a missing one. */
export function lineItemNotFound(itemId: string): DomainError {
  return new DomainError(
    'NOT_FOUND',
    'ITEM_NOT_FOUND',
    `Item ${itemId} not found`,
    { id: itemId },
  );
}
