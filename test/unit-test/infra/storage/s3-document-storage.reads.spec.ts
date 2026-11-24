import { Upload } from '@aws-sdk/lib-storage';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';

import { S3DocumentStorage } from '../../../../src/infra/storage/s3-document-storage';

const KEY = 'users/user-1/service-invoices/invoice-1/original';

const storageWith = (settings: Record<string, string>) =>
  new S3DocumentStorage({
    get: (name: string) => settings[name],
  } as unknown as ConfigService);

describe('S3DocumentStorage', () => {
  const previous = { ...process.env };
  let storage: S3DocumentStorage;
  let send: jest.Mock;

  beforeAll(() =>
    Object.assign(process.env, {
      AWS_ACCESS_KEY_ID: 'test',
      AWS_SECRET_ACCESS_KEY: 'test',
    }),
  );
  afterAll(() => {
    process.env = previous;
  });

  beforeEach(() => {
    storage = storageWith({
      S3_BUCKET: 'documents',
      AWS_ENDPOINT_URL: 'http://localhost:4566',
    });
    send = jest.fn();
  });

  afterEach(() => jest.restoreAllMocks());

  const stubClient = () => Object.assign(storage, { client: { send } });

  it('refuses to start without a bucket', () => {
    expect(() => storageWith({})).toThrow('S3_BUCKET is not set');
  });

  it('signs virtual-hosted URLs when there is no local endpoint', async () => {
    const production = storageWith({
      S3_BUCKET: 'documents',
      AWS_REGION: 'sa-east-1',
    });

    const { url } = await production.createPresignedGet({
      key: KEY,
      expiresInMs: 60_000,
    });

    expect(new URL(url).host).toBe('documents.s3.sa-east-1.amazonaws.com');
  });

  it('pins key, type and exact size in the presigned POST policy', async () => {
    const before = Date.now();

    const { fields, expiresAt } = await storage.createPresignedPost({
      key: KEY,
      contentType: 'application/pdf',
      contentLength: 1234,
      expiresInMs: 90_000,
    });

    const policy = JSON.parse(
      Buffer.from(fields.Policy, 'base64').toString('utf8'),
    ) as { conditions: unknown[] };
    expect(policy.conditions).toEqual(
      expect.arrayContaining([
        { bucket: 'documents' },
        ['eq', '$key', KEY],
        ['eq', '$Content-Type', 'application/pdf'],
        ['content-length-range', 1234, 1234],
      ]),
    );
    expect(fields['Content-Type']).toBe('application/pdf');
    expect(expiresAt).toBeGreaterThanOrEqual(before + 90_000);
  });

  describe('headDocument', () => {
    beforeEach(stubClient);

    it('describes the stored object', async () => {
      send.mockResolvedValue({
        ContentLength: 10,
        ContentType: 'application/pdf',
      });

      await expect(storage.headDocument(KEY)).resolves.toEqual({
        contentLength: 10,
        contentType: 'application/pdf',
      });
    });

    it('leaves out what S3 did not answer', async () => {
      send.mockResolvedValue({});

      await expect(storage.headDocument(KEY)).resolves.toEqual({
        contentLength: 0,
      });
    });

    it.each([
      [{ $metadata: { httpStatusCode: 404 } }],
      [{ name: 'NotFound' }],
      [{ name: 'NoSuchKey' }],
    ])('answers null for a missing object (%j)', async error => {
      send.mockRejectedValue(error);

      await expect(storage.headDocument(KEY)).resolves.toBeNull();
    });

    it.each([
      [{ name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }],
      ['network down'],
      [null],
    ])('does not hide any other failure (%j)', async error => {
      send.mockRejectedValue(error);

      await expect(storage.headDocument(KEY)).rejects.toEqual(error);
    });
  });

  describe('getDocument', () => {
    beforeEach(stubClient);

    it('reads the bytes of the object', async () => {
      const bytes = new Uint8Array([1, 2, 3]);
      send.mockResolvedValue({
        Body: { transformToByteArray: () => Promise.resolve(bytes) },
      });

      await expect(storage.getDocument(KEY)).resolves.toEqual(bytes);
    });

    it('answers no bytes for an object without a body', async () => {
      send.mockResolvedValue({});

      await expect(storage.getDocument(KEY)).resolves.toEqual(new Uint8Array());
    });

    it('answers null for a missing object', async () => {
      send.mockRejectedValue({ name: 'NoSuchKey' });

      await expect(storage.getDocument(KEY)).resolves.toBeNull();
    });

    it('does not hide any other failure', async () => {
      send.mockRejectedValue(new Error('AccessDenied'));

      await expect(storage.getDocument(KEY)).rejects.toThrow('AccessDenied');
    });
  });

  describe('putDocumentStream', () => {
    const request = (signal?: AbortSignal) => ({
      key: KEY,
      body: Readable.from(['zip']),
      contentType: 'application/zip',
      signal,
    });
    let done: jest.SpyInstance;
    let abort: jest.SpyInstance;

    beforeEach(() => {
      done = jest
        .spyOn(Upload.prototype, 'done')
        .mockResolvedValue({} as never);
      abort = jest.spyOn(Upload.prototype, 'abort').mockResolvedValue();
    });

    it('uploads without aborting', async () => {
      await storage.putDocumentStream(request());

      expect(done).toHaveBeenCalledTimes(1);
      expect(abort).not.toHaveBeenCalled();
    });

    it('aborts the upload when the caller already gave up', async () => {
      await storage.putDocumentStream(request(AbortSignal.abort()));

      expect(abort).toHaveBeenCalledTimes(1);
    });

    it('aborts the upload when the caller gives up meanwhile', async () => {
      const controller = new AbortController();
      done.mockImplementation(() => {
        controller.abort();
        return Promise.reject(new Error('aborted'));
      });

      await expect(
        storage.putDocumentStream(request(controller.signal)),
      ).rejects.toThrow('aborted');
      expect(abort).toHaveBeenCalledTimes(1);
    });

    it('stops listening to the signal once the upload ends', async () => {
      const controller = new AbortController();

      await storage.putDocumentStream(request(controller.signal));
      controller.abort();

      expect(abort).not.toHaveBeenCalled();
    });
  });
});
