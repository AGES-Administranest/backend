import { Prisma } from '@prisma/client';

import { ServiceInvoiceCountService } from '../../../src/modules/service-invoices/service-invoice-count.service';

const PERIOD = {} as never;

describe('ServiceInvoiceCountService', () => {
  const repository = {
    countConfirmedInPeriod: jest.fn(),
    summarizeTaxPackage: jest.fn(),
    findTaxPackageNotes: jest.fn(),
  };
  const service = new ServiceInvoiceCountService(repository as never);

  beforeEach(() => jest.resetAllMocks());

  it('counts and summarizes for the given user', async () => {
    const totals = { count: 1, totalAmount: 2, bytesSize: 3, missingFiles: 4 };
    repository.countConfirmedInPeriod.mockResolvedValue(7);
    repository.summarizeTaxPackage.mockResolvedValue(totals);

    await expect(
      service.countConfirmedInPeriod('user-1', PERIOD),
    ).resolves.toBe(7);
    await expect(service.summarizeTaxPackage('user-1', PERIOD)).resolves.toBe(
      totals,
    );
    expect(repository.summarizeTaxPackage).toHaveBeenCalledWith(
      'user-1',
      PERIOD,
    );
  });

  it('describes the documents of the tax package', async () => {
    const issueDate = new Date('2026-10-20');
    repository.findTaxPackageNotes.mockResolvedValue([
      {
        id: 'note-1',
        issueDate,
        amount: new Prisma.Decimal('150.50'),
        fileName: 'note.pdf',
        fileMimeType: 'application/pdf',
        client: { name: 'Clinic' },
      },
      {
        id: 'note-2',
        issueDate,
        amount: null,
        fileName: null,
        fileMimeType: null,
        client: null,
      },
      { id: 'undated', issueDate: null },
    ]);

    await expect(
      service.listTaxPackageDocuments('user-1', PERIOD, 10),
    ).resolves.toEqual([
      {
        collection: 'service-invoices',
        id: 'note-1',
        issueDate,
        counterpartName: 'Clinic',
        amount: 150.5,
        fileName: 'note.pdf',
        mimeType: 'application/pdf',
      },
      {
        collection: 'service-invoices',
        id: 'note-2',
        issueDate,
        counterpartName: null,
        amount: null,
        fileName: null,
        mimeType: null,
      },
    ]);
    expect(repository.findTaxPackageNotes).toHaveBeenCalledWith(
      'user-1',
      PERIOD,
      10,
    );
  });
});
