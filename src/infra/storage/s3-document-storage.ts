import { S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  DocumentStorage,
  PresignedPost,
  PresignedPostRequest,
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

  /** Policy conditions come from §7.3; the length range is closed on purpose. */
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
}
