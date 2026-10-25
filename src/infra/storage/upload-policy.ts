/** What one kind of document accepts. Each module owns the policy of its own. */
export type UploadPolicy = {
  allowedMimeTypes: readonly string[];
  maxBytesSize: number;
  presignedTtlMs: number;
};

/** What the app says it is about to upload, before the bucket confirms it. */
export type DeclaredFile = {
  mimeType: string;
  bytesSize: number;
};
