import { UniqueConstraintError } from '../../../src/infra/prisma/prisma-errors';
import { CreateServiceInvoiceUploadUrlDto } from '../../../src/modules/service-invoices/dto/create-upload-url.dto';
import { ServiceInvoiceUploadService } from '../../../src/modules/service-invoices/service-invoice-upload.service';

const USER = 'user-1';
const ID = '5f3b7d0c-2a1e-4c7b-9a11-1f2e3d4c5b6a';
const draft = {
  id: ID,
  userId: USER,
  status: 'DRAFT',
  extractionStatus: 'PENDING',
};
const upload: CreateServiceInvoiceUploadUrlDto = {
  filename: 'nfse.pdf',
  fileMimeType: 'application/pdf',
  fileHash: 'a'.repeat(64),
  fileBytesSize: 100,
};

describe('ServiceInvoiceUploadService under races', () => {
  let repository: Record<string, jest.Mock>;
  let uploads: { signUpload: jest.Mock };
  let service: ServiceInvoiceUploadService;

  beforeEach(() => {
    repository = {
      findByIdAndUser: jest.fn().mockResolvedValue(null),
      findIdByFileHash: jest.fn().mockResolvedValue('holder'),
      create: jest.fn().mockRejectedValue(new UniqueConstraintError(['id'])),
      update: jest.fn().mockResolvedValue({}),
    };
    uploads = { signUpload: jest.fn().mockReturnValue('signed') };
    service = new ServiceInvoiceUploadService(
      repository as never,
      uploads as never,
      {} as never,
      {} as never,
    );
  });

  const create = () => service.createUploadUrl(USER, ID, upload);

  it('takes over the draft its own retry created first', async () => {
    repository.findByIdAndUser
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(draft);

    await expect(create()).resolves.toBe('signed');
    expect(repository.update).toHaveBeenCalledWith(
      ID,
      expect.objectContaining({ fileHash: upload.fileHash, uploadedAt: null }),
    );
  });

  it('does not reveal an id that belongs to someone else', async () => {
    await expect(create()).rejects.toMatchObject({
      code: 'SERVICE_INVOICE_NOT_FOUND',
    });
    expect(uploads.signUpload).not.toHaveBeenCalled();
  });

  it('tells which note holds the file a replacement repeats', async () => {
    repository.findByIdAndUser.mockResolvedValue(draft);
    repository.update.mockRejectedValue(
      new UniqueConstraintError(['file_hash']),
    );

    await expect(create()).rejects.toMatchObject({
      code: 'SERVICE_INVOICE_FILE_DUPLICATED',
      details: { serviceInvoiceId: 'holder' },
    });
  });

  it('lets an unknown failure through', async () => {
    repository.create.mockRejectedValue(new Error('connection lost'));
    await expect(create()).rejects.toThrow('connection lost');

    repository.findByIdAndUser.mockResolvedValue(draft);
    repository.update.mockRejectedValue(new Error('connection lost'));
    await expect(create()).rejects.toThrow('connection lost');
  });
});
