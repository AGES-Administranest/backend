import { UploadPolicy } from '../../infra/storage';

/** Only a PDF: an NFSe photo would carry no text layer to read. */
export const SERVICE_INVOICE_UPLOAD = {
  allowedMimeTypes: ['application/pdf'],
  maxBytesSize: 15 * 1024 * 1024,
  presignedTtlMs: 10 * 60 * 1000,
} as const satisfies UploadPolicy;

/** Past this a value no longer fits the `DECIMAL(14, 2)` column. */
export const MAX_SERVICE_INVOICE_AMOUNT = 999_999_999_999.99;
