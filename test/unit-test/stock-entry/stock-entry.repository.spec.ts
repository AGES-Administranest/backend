import { Prisma } from '@prisma/client';

import { StockEntryRepository } from '../../../src/modules/stock-entry/stock-entry.repository';
import { periodFromIsoDates } from '../../../src/shared/dates/period';

const USER = 'user-1';
const INVOICE = 'invoice-1';
const OCTOBER = periodFromIsoDates('2026-10-01', '2026-10-31');
const CONFIRMED_IN_OCTOBER = {
  userId: USER,
  deletedAt: null,
  status: 'CONFIRMED',
  issueDate: {
    gte: new Date('2026-10-01T00:00:00.000Z'),
    lt: new Date('2026-11-01T00:00:00.000Z'),
  },
};
const OWN_DRAFT = {
  id: INVOICE,
  userId: USER,
  status: 'DRAFT',
  deletedAt: null,
};
const anyDate = expect.any(Date) as Date;

describe('StockEntryRepository', () => {
  let invoices: Record<string, jest.Mock>;
  let tx: {
    purchaseInvoice: { updateMany: jest.Mock };
    purchaseInvoiceLine: { deleteMany: jest.Mock; createMany: jest.Mock };
  };
  let repository: StockEntryRepository;

  beforeEach(() => {
    invoices = {
      count: jest.fn().mockResolvedValue(2),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: INVOICE }),
      update: jest.fn().mockResolvedValue({ id: INVOICE }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    tx = {
      purchaseInvoice: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      purchaseInvoiceLine: { deleteMany: jest.fn(), createMany: jest.fn() },
    };
    repository = new StockEntryRepository({
      purchaseInvoice: invoices,
      $transaction: (work: (inside: unknown) => unknown) => work(tx),
    } as never);
  });

  it('counts the confirmed invoices of the period', async () => {
    await expect(
      repository.countConfirmedInPeriod(USER, OCTOBER),
    ).resolves.toBe(2);
    expect(invoices.count).toHaveBeenCalledWith({
      where: CONFIRMED_IN_OCTOBER,
    });
  });

  it.each([
    [new Prisma.Decimal(80), 80],
    [null, 0],
  ])('adds up the purchases of the period (%p)', async (sum, expected) => {
    invoices.aggregate.mockResolvedValue({
      _count: { _all: 2 },
      _sum: { totalAmount: sum },
    });

    const totals = await repository.sumConfirmedInPeriod(USER, OCTOBER);

    expect(totals.count).toBe(2);
    expect(totals.total.toNumber()).toBe(expected);
    expect(invoices.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: CONFIRMED_IN_OCTOBER }),
    );
  });

  it('adds up the purchases by supplier, no supplier included', async () => {
    invoices.groupBy.mockResolvedValue([
      {
        supplierId: 'supplier-1',
        _count: { _all: 1 },
        _sum: { totalAmount: new Prisma.Decimal(10) },
      },
      {
        supplierId: null,
        _count: { _all: 2 },
        _sum: { totalAmount: null },
      },
    ]);

    const rows = await repository.sumConfirmedBySupplierInPeriod(USER, OCTOBER);

    expect(
      rows.map(row => [row.supplierId, row.count, row.total.toNumber()]),
    ).toEqual([
      ['supplier-1', 1, 10],
      [null, 2, 0],
    ]);
  });

  it.each([
    [{ totalAmount: new Prisma.Decimal(5), fileBytesSize: 9 }, 5, 9],
    [{ totalAmount: null, fileBytesSize: null }, 0, 0],
  ])(
    'summarizes the tax package (%j)',
    async (_sum, totalAmount, bytesSize) => {
      invoices.aggregate.mockResolvedValue({ _count: { _all: 1 }, _sum });

      await expect(
        repository.summarizeTaxPackage(USER, OCTOBER),
      ).resolves.toEqual({ count: 1, totalAmount, bytesSize, missingFiles: 2 });
      expect(invoices.count).toHaveBeenCalledWith({
        where: {
          ...CONFIRMED_IN_OCTOBER,
          OR: [{ fileUrl: null }, { uploadedAt: null }],
        },
      });
    },
  );

  it('lists the invoices of the tax package that have their file', async () => {
    await repository.findTaxPackageInvoices(USER, OCTOBER, 7);

    expect(invoices.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ...CONFIRMED_IN_OCTOBER,
          fileUrl: { not: null },
          uploadedAt: { not: null },
        },
        orderBy: [{ issueDate: 'asc' }, { id: 'asc' }],
        take: 7,
      }),
    );
  });

  it('reads an invoice, with or without lines, only for its owner', async () => {
    await repository.findByIdAndUser(INVOICE, USER);
    await repository.findWithLines(INVOICE, USER);

    for (const [call] of invoices.findFirst.mock.calls as [unknown][]) {
      expect(call).toMatchObject({
        where: { id: INVOICE, userId: USER, deletedAt: null },
      });
    }
    expect(invoices.findFirst).toHaveBeenCalledTimes(2);
  });

  it('lists the drafts of the user, last touched first', async () => {
    await repository.findDrafts(USER);

    expect(invoices.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER, status: 'DRAFT', deletedAt: null },
        orderBy: { updatedAt: 'desc' },
      }),
    );
  });

  it.each([
    [{}, {}],
    [
      { issuedTo: new Date('2026-10-31') },
      { issueDate: { gte: undefined, lte: new Date('2026-10-31') } },
    ],
  ])('lists the invoices of a supplier (%j)', async (filters, condition) => {
    await repository.findConfirmedBySupplier(
      USER,
      'supplier-1',
      filters,
      5,
      10,
    );

    expect(invoices.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: USER,
          supplierId: 'supplier-1',
          status: 'CONFIRMED',
          deletedAt: null,
          ...condition,
        },
        skip: 5,
        take: 10,
      }),
    );
  });

  it('finds the invoice that holds a file', async () => {
    await expect(
      repository.findIdByFileHash(USER, 'hash'),
    ).resolves.toBeUndefined();

    invoices.findFirst.mockResolvedValue({ id: INVOICE });
    await expect(repository.findIdByFileHash(USER, 'hash')).resolves.toBe(
      INVOICE,
    );
  });

  it('confirms a draft and writes the stock in the same transaction', async () => {
    const write = jest.fn();

    await expect(repository.confirmDraft(INVOICE, USER, write)).resolves.toBe(
      true,
    );
    expect(tx.purchaseInvoice.updateMany).toHaveBeenCalledWith({
      where: OWN_DRAFT,
      data: { status: 'CONFIRMED', reviewedAt: anyDate, updatedAt: anyDate },
    });
    expect(write).toHaveBeenCalledWith(tx);
  });

  it('writes no stock when the draft was already confirmed or discarded', async () => {
    tx.purchaseInvoice.updateMany.mockResolvedValue({ count: 0 });
    const write = jest.fn();

    await expect(repository.confirmDraft(INVOICE, USER, write)).resolves.toBe(
      false,
    );
    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    [1, true],
    [0, false],
  ])('says whether the draft was written (%i row)', async (count, written) => {
    invoices.updateMany.mockResolvedValue({ count });

    await expect(
      repository.updateDraft(INVOICE, USER, { number: '10' }),
    ).resolves.toBe(written);
    expect(invoices.updateMany).toHaveBeenCalledWith({
      where: OWN_DRAFT,
      data: { number: '10', updatedAt: anyDate },
    });
  });

  it('replaces every line of the draft', async () => {
    const line = { position: 1, description: 'Propofol' } as never;

    await expect(repository.replaceLines(INVOICE, USER, [line])).resolves.toBe(
      true,
    );
    expect(tx.purchaseInvoiceLine.deleteMany).toHaveBeenCalledWith({
      where: { purchaseInvoiceId: INVOICE },
    });
    expect(tx.purchaseInvoiceLine.createMany).toHaveBeenCalledWith({
      data: [
        { position: 1, description: 'Propofol', purchaseInvoiceId: INVOICE },
      ],
    });
  });

  it('keeps the lines of an invoice that is no longer a draft', async () => {
    tx.purchaseInvoice.updateMany.mockResolvedValue({ count: 0 });

    await expect(repository.replaceLines(INVOICE, USER, [])).resolves.toBe(
      false,
    );
    expect(tx.purchaseInvoiceLine.deleteMany).not.toHaveBeenCalled();
    expect(tx.purchaseInvoiceLine.createMany).not.toHaveBeenCalled();
  });

  it('creates and updates by id', async () => {
    await repository.create({ id: INVOICE } as never);
    await repository.update(INVOICE, { number: '10' });

    expect(invoices.create).toHaveBeenCalledWith({ data: { id: INVOICE } });
    expect(invoices.update).toHaveBeenCalledWith({
      where: { id: INVOICE },
      data: { number: '10' },
    });
  });

  it.each([
    [1, true],
    [0, false],
  ])('claims a reading once (%i row)', async (count, claimed) => {
    const staleBefore = new Date('2026-10-01');
    invoices.updateMany.mockResolvedValue({ count });

    await expect(
      repository.claimExtraction(INVOICE, staleBefore),
    ).resolves.toBe(claimed);
    expect(invoices.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: INVOICE,
          status: 'DRAFT',
          deletedAt: null,
          OR: [
            { extractionStatus: { in: ['PENDING', 'FAILED'] } },
            { extractionStatus: 'PROCESSING', updatedAt: { lt: staleBefore } },
          ],
        },
      }),
    );
  });
});
