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

  /**
   * The object's bytes, or `null` when nothing is at that key. Only for the
   * extraction: the policy caps the object at the declared size, so it fits in
   * memory.
   */
  abstract getDocument(key: string): Promise<Uint8Array | null>;

  /**
   * Writes a file the API itself produced, such as a generated report (US28).
   * Files the user sends never pass through here: they go straight to the
   * bucket with a presigned POST (ADR-03).
   */
  abstract putDocument(
    key: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<void>;

  abstract createPresignedGet(
    request: PresignedGetRequest,
  ): Promise<PresignedGet>;

  /**
   * Deletes every object whose key starts with `prefix` and returns how many
   * went. Idempotent: an empty prefix is a success that deleted nothing, which
   * is what lets an interrupted account deletion be retried.
   *
   * The prefix must end in `/`, so `users/1/` cannot take `users/10/` with it.
   */
  abstract deletePrefix(prefix: string): Promise<number>;
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

export type PresignedGetRequest = {
  key: string;
  expiresInMs: number;
  /** The key has no extension, so without this the file saves as `original`. */
  fileName?: string;
};

export type PresignedGet = {
  url: string;
  /** Ms since the epoch, comparable with `Date.now()` on the client. */
  expiresAt: number;
};

export type StoredDocument = {
  contentLength: number;
  /** Absent only if the object was written without one — ours never are. */
  contentType?: string;
};
