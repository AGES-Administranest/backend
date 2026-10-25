import { UploadPolicy } from '../../infra/storage';

export const PURCHASE_INVOICE_UPLOAD = {
  allowedMimeTypes: ['application/pdf', 'image/jpeg'],
  maxBytesSize: 15 * 1024 * 1024,
  presignedTtlMs: 10 * 60 * 1000,
} as const satisfies UploadPolicy;

/**
 * The reader stops at 50 pages; a dense order fits about 40 lines a page. The
 * cap keeps one save from carrying an unbounded body.
 */
export const MAX_DRAFT_LINES = 2000;

/** Past this a value no longer fits the `DECIMAL(14, x)` columns. */
export const MAX_DRAFT_AMOUNT = 999_999_999;
