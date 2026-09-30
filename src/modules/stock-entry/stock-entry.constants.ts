export const ALLOWED_FILE_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
] as const;

export const MAX_FILE_BYTES_SIZE = 15 * 1024 * 1024;

export const PRESIGNED_TTL_MS = 10 * 60 * 1000;

/** Past this the reading is dropped and the invoice fails with TIMEOUT. */
export const EXTRACTION_TIMEOUT_MS = 20 * 1000;

/**
 * The reader stops at 50 pages; a dense order fits about 40 lines a page. The
 * cap keeps one save from carrying an unbounded body.
 */
export const MAX_DRAFT_LINES = 2000;

/** Past this a value no longer fits the `DECIMAL(14, x)` columns. */
export const MAX_DRAFT_AMOUNT = 999_999_999;
