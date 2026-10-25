import { Injectable } from '@nestjs/common';

import {
  DocumentStorage,
  PresignedGet,
  PresignedPost,
  StoredDocument,
} from './document-storage';
import { DeclaredFile, UploadPolicy } from './upload-policy';

export const DOWNLOAD_TTL_MS = 5 * 60 * 1000;

export type UploadCheck =
  | { status: 'stored'; document: StoredDocument }
  | { status: 'missing' }
  | {
      status: 'mismatch';
      field: 'contentType' | 'contentLength';
      declared: string | number;
      stored?: string | number;
    };

/** What the row recorded when the upload was signed. A missing value is not checked. */
export type RecordedFile = {
  mimeType: string | null;
  bytesSize: number | null;
};

/**
 * The upload cycle every document shares. It writes nothing to the database
 * and raises no domain error: each module turns an `UploadCheck` into its own
 * codes.
 */
@Injectable()
export class DocumentUploads {
  constructor(private readonly storage: DocumentStorage) {}

  signUpload(
    key: string,
    file: DeclaredFile,
    policy: UploadPolicy,
  ): Promise<PresignedPost> {
    return this.storage.createPresignedPost({
      key,
      contentType: file.mimeType,
      contentLength: file.bytesSize,
      expiresInMs: policy.presignedTtlMs,
    });
  }

  /**
   * The policy pinned type and size to what the app declared, so a divergence
   * means the object at the key is not the one that was signed for.
   */
  async verifyUpload(
    key: string,
    declared: RecordedFile,
  ): Promise<UploadCheck> {
    const stored = await this.storage.headDocument(key);
    if (!stored) return { status: 'missing' };

    if (declared.mimeType && stored.contentType !== declared.mimeType) {
      return {
        status: 'mismatch',
        field: 'contentType',
        declared: declared.mimeType,
        stored: stored.contentType,
      };
    }
    if (
      declared.bytesSize !== null &&
      stored.contentLength !== declared.bytesSize
    ) {
      return {
        status: 'mismatch',
        field: 'contentLength',
        declared: declared.bytesSize,
        stored: stored.contentLength,
      };
    }
    return { status: 'stored', document: stored };
  }

  createDownloadUrl(key: string, fileName?: string): Promise<PresignedGet> {
    return this.storage.createPresignedGet({
      key,
      expiresInMs: DOWNLOAD_TTL_MS,
      ...(fileName && { fileName }),
    });
  }
}
