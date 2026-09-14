import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  DocumentStorage,
  PresignedPost,
  PresignedPostRequest,
  StoredDocument,
} from './document-storage';

const DEFAULT_REGION = 'us-east-1';

/**
 * Same code local and in production, only the endpoint changes (ADR-12).
 * Credentials are never read here: the emulator ignores them, and production
 * takes them from the instance role through the SDK's default chain.
 */
@Injectable()
export class S3DocumentStorage extends DocumentStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    super();

    const endpoint = config.get<string>('AWS_ENDPOINT_URL');
    const bucket = config.get<string>('S3_BUCKET');
    if (!bucket) {
      throw new Error(
        'S3_BUCKET is not set. Copy .env.example into .env and run ' +
          '`npm run dev:bootstrap` (see docs/ambiente-local.md).',
      );
    }

    this.bucket = bucket;
    this.client = new S3Client({
      region: config.get<string>('AWS_REGION') ?? DEFAULT_REGION,
      // Path style only against the emulator: `bucket.localhost` resolves nowhere.
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
  }

  /** The length range in the policy is closed on purpose. */
  async createPresignedPost(
    request: PresignedPostRequest,
  ): Promise<PresignedPost> {
    const signedAt = Date.now();

    const { url, fields } = await createPresignedPost(this.client, {
      Bucket: this.bucket,
      Key: request.key,
      Expires: Math.floor(request.expiresInMs / 1000),
      Fields: { 'Content-Type': request.contentType },
      Conditions: [
        { bucket: this.bucket },
        ['eq', '$key', request.key],
        ['eq', '$Content-Type', request.contentType],
        ['content-length-range', request.contentLength, request.contentLength],
      ],
    });

    return { url, fields, expiresAt: signedAt + request.expiresInMs };
  }

  async headDocument(key: string): Promise<StoredDocument | null> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );

      return {
        contentLength: head.ContentLength ?? 0,
        ...(head.ContentType ? { contentType: head.ContentType } : {}),
      };
    } catch (error) {
      // A missing object is an answer, not a failure: it is how the API learns
      // the upload never arrived. Anything else is a real problem and goes up.
      if (this.isNotFound(error)) return null;
      throw error;
    }
  }

  /**
   * `HeadObject` has no body, so the SDK cannot name the error the way it does
   * for `GetObject` (`NoSuchKey`): what comes back is a bare 404.
   */
  private isNotFound(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;

    const { name, $metadata } = error as {
      name?: string;
      $metadata?: { httpStatusCode?: number };
    };

    return (
      $metadata?.httpStatusCode === 404 ||
      name === 'NotFound' ||
      name === 'NoSuchKey'
    );
  }
}
