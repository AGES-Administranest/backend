import {
  DocumentStorage,
  DocumentUploads,
  DOWNLOAD_TTL_MS,
  StoredDocument,
} from '../../../../src/infra/storage';

const KEY = 'users/user-1/purchase-invoices/invoice-1/original';
const PDF = { mimeType: 'application/pdf', bytesSize: 2048 };

describe('DocumentUploads', () => {
  let stored: StoredDocument | null;
  let createPresignedPost: jest.Mock;
  let createPresignedGet: jest.Mock;
  let uploads: DocumentUploads;

  beforeEach(() => {
    stored = { contentLength: 2048, contentType: 'application/pdf' };
    createPresignedPost = jest.fn();
    createPresignedGet = jest.fn();
    const storage = {
      createPresignedPost,
      createPresignedGet,
      headDocument: () => Promise.resolve(stored),
    };
    uploads = new DocumentUploads(storage as unknown as DocumentStorage);
  });

  it('signs the declared type and size for as long as the policy says', async () => {
    await uploads.signUpload(KEY, PDF, {
      allowedMimeTypes: ['application/pdf'],
      maxBytesSize: 4096,
      presignedTtlMs: 60_000,
    });

    expect(createPresignedPost).toHaveBeenCalledWith({
      key: KEY,
      contentType: 'application/pdf',
      contentLength: 2048,
      expiresInMs: 60_000,
    });
  });

  describe('upload verification', () => {
    it('answers what the bucket holds when it matches the declaration', async () => {
      await expect(uploads.verifyUpload(KEY, PDF)).resolves.toEqual({
        status: 'stored',
        document: { contentLength: 2048, contentType: 'application/pdf' },
      });
    });

    it('reports a missing object', async () => {
      stored = null;

      await expect(uploads.verifyUpload(KEY, PDF)).resolves.toEqual({
        status: 'missing',
      });
    });

    it('reports a type other than the declared one', async () => {
      stored = { contentLength: 2048, contentType: 'image/jpeg' };

      await expect(uploads.verifyUpload(KEY, PDF)).resolves.toEqual({
        status: 'mismatch',
        field: 'contentType',
        declared: 'application/pdf',
        stored: 'image/jpeg',
      });
    });

    it('reports a size other than the declared one', async () => {
      stored = { contentLength: 10, contentType: 'application/pdf' };

      await expect(uploads.verifyUpload(KEY, PDF)).resolves.toEqual({
        status: 'mismatch',
        field: 'contentLength',
        declared: 2048,
        stored: 10,
      });
    });

    it('does not check what was never declared', async () => {
      stored = { contentLength: 10, contentType: 'image/jpeg' };

      await expect(
        uploads.verifyUpload(KEY, { mimeType: null, bytesSize: null }),
      ).resolves.toMatchObject({ status: 'stored' });
    });
  });

  it('signs a download under the original file name', async () => {
    await uploads.createDownloadUrl(KEY, 'nota-123.pdf');

    expect(createPresignedGet).toHaveBeenCalledWith({
      key: KEY,
      expiresInMs: DOWNLOAD_TTL_MS,
      fileName: 'nota-123.pdf',
    });
  });
});
