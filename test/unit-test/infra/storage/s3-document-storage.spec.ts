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

  it('deletes the object at the key', async () => {
    const send = jest.fn().mockResolvedValue({});
    Object.assign(storage, { client: { send } });

    await storage.deleteDocument(KEY);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ input: { Bucket: 'documents', Key: KEY } }),
    );
  });

  it('writes the bytes at the key with their content type', async () => {
    const send = jest.fn().mockResolvedValue({});
    Object.assign(storage, { client: { send } });
    const body = new Uint8Array([37, 80, 68, 70]);

    await storage.putDocument(KEY, body, 'application/pdf');

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          Bucket: 'documents',
          Key: KEY,
          Body: body,
          ContentType: 'application/pdf',
        },
      }),
    );
  });
});

describe('S3DocumentStorage.deletePrefix', () => {
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
    storage = new S3DocumentStorage({
      get: (name: string) =>
        ({ S3_BUCKET: 'documents', AWS_ENDPOINT_URL: 'http://localhost:4566' })[
          name
        ],
    } as unknown as ConfigService);
    send = jest.fn();
    (storage as unknown as { client: { send: jest.Mock } }).client = { send };
  });

  const commandInput = (call: number) =>
    (send.mock.calls[call] as [{ input: Record<string, unknown> }])[0].input;

  it('deletes every page of the listing', async () => {
    send
      .mockResolvedValueOnce({
        Contents: [{ Key: 'users/1/a' }, { Key: 'users/1/b' }],
        IsTruncated: true,
        NextContinuationToken: 'page-2',
      })
      .mockResolvedValueOnce({}) // DeleteObjects, page 1
      .mockResolvedValueOnce({ Contents: [{ Key: 'users/1/c' }] })
      .mockResolvedValueOnce({}); // DeleteObjects, page 2

    await expect(storage.deletePrefix('users/1/')).resolves.toBe(3);

    expect(commandInput(0)).toMatchObject({
      Bucket: 'documents',
      Prefix: 'users/1/',
    });
    expect(commandInput(2)).toMatchObject({ ContinuationToken: 'page-2' });
    expect(commandInput(3)).toMatchObject({
      Delete: { Objects: [{ Key: 'users/1/c' }] },
    });
  });

  it('is a success when there is nothing under the prefix', async () => {
    send.mockResolvedValueOnce({});

    await expect(storage.deletePrefix('users/1/')).resolves.toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not report success when S3 refuses to delete an object', async () => {
    send
      .mockResolvedValueOnce({ Contents: [{ Key: 'users/1/a' }] })
      .mockResolvedValueOnce({
        Errors: [{ Key: 'users/1/a', Code: 'AccessDenied' }],
      });

    await expect(storage.deletePrefix('users/1/')).rejects.toThrow(
      /refused to delete 1 of 1/,
    );
  });

  it('refuses a prefix that could match another user’s keys', async () => {
    await expect(storage.deletePrefix('users/1')).rejects.toThrow(
      /trailing slash/,
    );
    expect(send).not.toHaveBeenCalled();
  });
});
