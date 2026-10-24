import { ConfigService } from '@nestjs/config';

import { S3DocumentStorage } from '../../../../src/infra/storage/s3-document-storage';

const KEY = 'users/user-1/service-invoices/invoice-1/original';

// The presigned GET is computed locally, so fake credentials are enough.
const CREDENTIALS = {
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
};

describe('S3DocumentStorage presigned download', () => {
  const previous = { ...process.env };
  let storage: S3DocumentStorage;

  beforeAll(() => Object.assign(process.env, CREDENTIALS));
  afterAll(() => {
    process.env = previous;
  });

  beforeEach(() => {
    const settings: Record<string, string> = {
      S3_BUCKET: 'documents',
      AWS_ENDPOINT_URL: 'http://localhost:4566',
    };
    storage = new S3DocumentStorage({
      get: (name: string) => settings[name],
    } as unknown as ConfigService);
  });

  it('signs the object at the key for the requested time', async () => {
    const { url, expiresAt } = await storage.createPresignedGet({
      key: KEY,
      expiresInMs: 60_000,
    });

    const signed = new URL(url);
    expect(signed.origin).toBe('http://localhost:4566');
    expect(signed.pathname).toBe(`/documents/${KEY}`);
    expect(signed.searchParams.get('X-Amz-Expires')).toBe('60');
    expect(signed.searchParams.has('response-content-disposition')).toBe(false);
    expect(expiresAt).toBeGreaterThan(Date.now());
  });

  it('names the download, accents included', async () => {
    const { url } = await storage.createPresignedGet({
      key: KEY,
      expiresInMs: 60_000,
      fileName: "nota d'água.pdf",
    });

    expect(new URL(url).searchParams.get('response-content-disposition')).toBe(
      `attachment; filename="nota d'_gua.pdf"; filename*=UTF-8''nota%20d%27%C3%A1gua.pdf`,
    );
  });
});
