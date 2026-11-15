/**
 * The package is built inside the request, so the limits are what keeps one
 * call from holding the instance: the summary announces them before the
 * app asks for the zip.
 */
export const TAX_PACKAGE_LIMITS = {
  maxDocuments: 500,
  maxBytesSize: 200 * 1024 * 1024,
  timeoutMs: 2 * 60 * 1000,
} as const;

export const TAX_PACKAGE_MIME_TYPE = 'application/zip';
