/**
 * Abstract class and not an interface: Nest injects by token, and an interface
 * leaves nothing behind at runtime.
 */
export abstract class DocumentStorage {
  abstract createPresignedPost(
    request: PresignedPostRequest,
  ): Promise<PresignedPost>;

  /**
   * Metadata of the stored object, or `null` when nothing is at that key.
   *
   * Reads no bytes: this exists so the API can verify an upload the client
   * claims to have finished without pulling the file into the instance.
   */
  abstract headDocument(key: string): Promise<StoredDocument | null>;
}

export type PresignedPostRequest = {
  key: string;
  contentType: string;
  contentLength: number;
  expiresInMs: number;
};

export type PresignedPost = {
  url: string;
  fields: Record<string, string>;
  /** Ms since the epoch, comparable with `Date.now()` on the client. */
  expiresAt: number;
};

export type StoredDocument = {
  contentLength: number;
  /** Absent only if the object was written without one — ours never are. */
  contentType?: string;
};
