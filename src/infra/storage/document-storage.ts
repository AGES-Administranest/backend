/**
 * Abstract class and not an interface: Nest injects by token, and an interface
 * leaves nothing behind at runtime.
 */
export abstract class DocumentStorage {
  abstract createPresignedPost(
    request: PresignedPostRequest,
  ): Promise<PresignedPost>;
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
