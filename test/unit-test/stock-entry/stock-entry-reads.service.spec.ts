import { Prisma } from '@prisma/client';

import { UniqueConstraintError } from '../../../src/infra/prisma/prisma-errors';
import { CreateUploadUrlDto } from '../../../src/modules/stock-entry/dto/create-upload-url.dto';
import { QuerySupplierInvoicesDto } from '../../../src/modules/stock-entry/dto/query-supplier-invoices.dto';
import { PURCHASE_INVOICE_UPLOAD } from '../../../src/modules/stock-entry/stock-entry.constants';
import { StockEntryService } from '../../../src/modules/stock-entry/stock-entry.service';

const USER = 'user-1';
const ID = '5f3b7d0c-2a1e-4c7b-9a11-1f2e3d4c5b6a';
const PERIOD = {} as never;
const ISSUED = new Date('2026-10-20T00:00:00.000Z');

const upload: CreateUploadUrlDto = {
  filename: 'order.pdf',
  fileMimeType: 'application/pdf',
  fileHash: 'a'.repeat(64),
  fileBytesSize: 100,
};

describe('StockEntryService', () => {
  let repository: Record<string, jest.Mock>;
  let uploads: { signUpload: jest.Mock };
  let suppliers: { findOne: jest.Mock };
  let service: StockEntryService;

  beforeEach(() => {
    repository = {
      countConfirmedInPeriod: jest.fn().mockResolvedValue(1),
      summarizeTaxPackage: jest.fn().mockResolvedValue('summary'),
      findTaxPackageInvoices: jest.fn(),
      sumConfirmedInPeriod: jest.fn().mockResolvedValue('totals'),
      sumConfirmedBySupplierInPeriod: jest.fn().mockResolvedValue('grouped'),
      findConfirmedBySupplier: jest.fn().mockResolvedValue([]),
      findByIdAndUser: jest.fn().mockResolvedValue(null),
      findIdByFileHash: jest.fn().mockResolvedValue('holder'),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    };
    uploads = { signUpload: jest.fn().mockReturnValue('signed') };
    suppliers = { findOne: jest.fn().mockResolvedValue({}) };
    service = new StockEntryService(
      repository as never,
      uploads as never,
      {} as never,
      suppliers as never,
    );
  });

  it('reads the period for the given user', async () => {
    await expect(service.countConfirmedInPeriod(USER, PERIOD)).resolves.toBe(1);
    await expect(service.summarizeTaxPackage(USER, PERIOD)).resolves.toBe(
      'summary',
    );
    await expect(service.purchaseTotalsInPeriod(USER, PERIOD)).resolves.toBe(
      'totals',
    );
    await expect(
      service.purchaseTotalsBySupplierInPeriod(USER, PERIOD),
    ).resolves.toBe('grouped');
    expect(repository.summarizeTaxPackage).toHaveBeenCalledWith(USER, PERIOD);
  });

  it('describes the documents of the tax package', async () => {
    const file = { fileName: 'a.pdf', fileMimeType: 'application/pdf' };
    repository.findTaxPackageInvoices.mockResolvedValue([
      {
        id: 'a',
        issueDate: ISSUED,
        totalAmount: new Prisma.Decimal(10),
        supplier: { name: 'Vet Supplies' },
        ...file,
      },
      {
        id: 'b',
        issueDate: ISSUED,
        totalAmount: null,
        supplier: null,
        ...file,
      },
      { id: 'undated', issueDate: null },
    ]);

    const documents = await service.listTaxPackageDocuments(USER, PERIOD, 10);

    const common = {
      collection: 'purchase-invoices',
      issueDate: ISSUED,
      fileName: 'a.pdf',
      mimeType: 'application/pdf',
    };
    expect(documents).toEqual([
      { ...common, id: 'a', counterpartName: 'Vet Supplies', amount: 10 },
      { ...common, id: 'b', counterpartName: null, amount: null },
    ]);
  });

  describe('listSupplierInvoices', () => {
    const query = (fields: Partial<QuerySupplierInvoicesDto> = {}) =>
      Object.assign(new QuerySupplierInvoicesDto(), fields);

    it('checks the supplier is of the user before listing', async () => {
      suppliers.findOne.mockRejectedValue(new Error('not found'));

      await expect(
        service.listSupplierInvoices(USER, 'supplier-1', query()),
      ).rejects.toThrow('not found');
      expect(repository.findConfirmedBySupplier).not.toHaveBeenCalled();
    });

    it('pages and filters by issue date', async () => {
      await service.listSupplierInvoices(
        USER,
        'supplier-1',
        query({ from: '2026-10-01', to: '2026-10-31', page: 2, limit: 10 }),
      );

      expect(repository.findConfirmedBySupplier).toHaveBeenCalledWith(
        USER,
        'supplier-1',
        {
          issuedFrom: new Date('2026-10-01T00:00:00.000Z'),
          issuedTo: new Date('2026-10-31T00:00:00.000Z'),
        },
        10,
        10,
      );
    });

    it('answers the date as a day and what is missing as null', async () => {
      repository.findConfirmedBySupplier.mockResolvedValue([
        {
          id: 'a',
          issueDate: ISSUED,
          number: '10',
          totalAmount: new Prisma.Decimal('9.90'),
        },
        { id: 'b', issueDate: null, number: null, totalAmount: null },
      ]);

      await expect(
        service.listSupplierInvoices(USER, 'supplier-1', query()),
      ).resolves.toEqual([
        { id: 'a', issueDate: '2026-10-20', number: '10', totalAmount: 9.9 },
        { id: 'b', issueDate: null, number: null, totalAmount: null },
      ]);
    });
  });

  describe('createUploadUrl', () => {
    const draft = {
      id: ID,
      userId: USER,
      status: 'DRAFT',
      extractionStatus: 'PENDING',
    };
    const create = (fields: Partial<CreateUploadUrlDto> = {}) =>
      service.createUploadUrl(USER, ID, { ...upload, ...fields });

    it('refuses a file over the limit before writing anything', async () => {
      await expect(
        create({ fileBytesSize: PURCHASE_INVOICE_UPLOAD.maxBytesSize + 1 }),
      ).rejects.toMatchObject({ kind: 'PAYLOAD_TOO_LARGE' });
      expect(repository.create).not.toHaveBeenCalled();
      expect(uploads.signUpload).not.toHaveBeenCalled();
    });

    it('takes over the draft its own retry created first', async () => {
      repository.create.mockRejectedValue(new UniqueConstraintError(['id']));
      repository.findByIdAndUser
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(draft);

      await expect(create()).resolves.toBe('signed');
      expect(repository.update).toHaveBeenCalledWith(
        ID,
        expect.objectContaining({ fileHash: upload.fileHash }),
      );
    });

    it('does not reveal an id that belongs to someone else', async () => {
      repository.create.mockRejectedValue(new UniqueConstraintError(['id']));

      await expect(create()).rejects.toMatchObject({ kind: 'NOT_FOUND' });
      expect(uploads.signUpload).not.toHaveBeenCalled();
    });

    it('tells which entry holds the file a replacement repeats', async () => {
      repository.findByIdAndUser.mockResolvedValue(draft);
      repository.update.mockRejectedValue(
        new UniqueConstraintError(['user_id', 'file_hash']),
      );

      await expect(create()).rejects.toMatchObject({
        code: 'INVOICE_FILE_DUPLICATED',
        details: { purchaseInvoiceId: 'holder' },
      });
    });

    it('stops reading once the file becomes a photo', async () => {
      repository.findByIdAndUser.mockResolvedValue(draft);

      await create({ fileMimeType: 'image/jpeg' });

      expect(repository.update).toHaveBeenCalledWith(
        ID,
        expect.objectContaining({
          extractionStatus: 'MANUAL',
          rawExtraction: Prisma.DbNull,
        }),
      );
    });

    it('lets an unknown failure through', async () => {
      repository.create.mockRejectedValueOnce(new Error('connection lost'));
      await expect(create()).rejects.toThrow('connection lost');

      repository.findByIdAndUser.mockResolvedValue(draft);
      repository.update.mockRejectedValue(new Error('connection lost'));
      await expect(create()).rejects.toThrow('connection lost');
    });
  });
});
