export const ALLOWED_FILE_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
] as const;

export const MAX_FILE_BYTES_SIZE = 15 * 1024 * 1024;

export const PRESIGNED_TTL_MS = 10 * 60 * 1000;
