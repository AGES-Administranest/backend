import { EntryNature, EntryScope, EntrySource, Prisma } from '@prisma/client';

import { RecordNotFoundError } from '../../../src/infra/prisma/prisma-errors';
import { FinancialEntryRepository } from '../../../src/modules/financial/financial-entry.repository';
import { periodFromIsoDates } from '../../../src/shared/dates/period';

const USER = 'user-1';
const ENTRY = 'entry-1';
const FROM = new Date('2026-10-01T00:00:00.000Z');
const TO = new Date('2026-11-01T00:00:00.000Z');
const STATEMENT = {
  userId: USER,
  deletedAt: null,
  accrualDate: { gte: FROM, lt: TO },
};

const entryClient = () => ({
  count: jest.fn().mockResolvedValue(3),
  groupBy: jest.fn().mockResolvedValue([]),
  findMany: jest.fn().mockResolvedValue([]),
  findFirst: jest.fn().mockResolvedValue(null),
  findUnique: jest.fn().mockResolvedValue(null),
  findFirstOrThrow: jest.fn().mockResolvedValue({ id: ENTRY }),
  create: jest.fn().mockResolvedValue({ id: ENTRY }),
  update: jest.fn().mockResolvedValue({ id: ENTRY }),
  updateMany: jest.fn().mockResolvedValue({ count: 1 }),
});

describe('FinancialEntryRepository', () => {
  let entries: ReturnType<typeof entryClient>;
  let tx: { financialEntry: ReturnType<typeof entryClient> };
  let repository: FinancialEntryRepository;

  beforeEach(() => {
    entries = entryClient();
    tx = { financialEntry: entryClient() };
    repository = new FinancialEntryRepository({
      financialEntry: entries,
    } as never);
  });

  it('counts a period by UTC days, as the statement does', async () => {
    const october = periodFromIsoDates('2026-10-01', '2026-10-31');

    await expect(repository.countInPeriod(USER, october)).resolves.toBe(3);
    expect(entries.count).toHaveBeenCalledWith({ where: STATEMENT });
  });

  describe('statement filter', () => {
    const whereOf = () =>
      (entries.findMany.mock.calls[0] as [{ where: unknown }])[0].where;

    it('has only the owner and the period by default', async () => {
      await repository.findStatement(USER, { from: FROM, to: TO }, 10, 5);

      expect(whereOf()).toEqual(STATEMENT);
      expect(entries.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ accrualDate: 'desc' }, { id: 'desc' }],
          skip: 10,
          take: 5,
        }),
      );
    });

    it('adds every filter that was given', async () => {
      const filters = {
        nature: EntryNature.EXPENSE,
        scope: EntryScope.PERSONAL,
        categoryId: 'category-1',
        source: EntrySource.TRIP,
      };

      await repository.findStatement(
        USER,
        { from: FROM, to: TO, ...filters },
        0,
        5,
      );

      expect(whereOf()).toEqual({ ...STATEMENT, ...filters });
    });
  });

  describe('sums', () => {
    const filter = { from: FROM, to: TO };

    it('adds up by scope, an empty sum being zero', async () => {
      entries.groupBy.mockResolvedValue([
        { scope: EntryScope.PERSONAL, _sum: { amount: null } },
        {
          scope: EntryScope.PROFESSIONAL,
          _sum: { amount: new Prisma.Decimal(7) },
        },
      ]);

      const rows = await repository.sumByScope(USER, filter);

      expect(rows.map(row => [row.scope, row.total.toNumber()])).toEqual([
        [EntryScope.PERSONAL, 0],
        [EntryScope.PROFESSIONAL, 7],
      ]);
      expect(entries.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ where: STATEMENT }),
      );
    });

    it('adds up by nature, scope and category', async () => {
      const group = {
        nature: EntryNature.EXPENSE,
        scope: EntryScope.PROFESSIONAL,
        categoryId: 'category-1',
      };
      entries.groupBy.mockResolvedValue([
        { ...group, _sum: { amount: new Prisma.Decimal(3) } },
        { ...group, _sum: { amount: null } },
      ]);

      const rows = await repository.sumByNatureScopeCategory(USER, filter);

      expect(rows.map(row => row.total.toNumber())).toEqual([3, 0]);
      expect(rows[0]).toMatchObject(group);
    });

    it('adds up only the income by source, whatever nature was asked', async () => {
      entries.groupBy.mockResolvedValue([
        {
          source: EntrySource.MANUAL,
          _sum: { amount: new Prisma.Decimal(9) },
        },
        { source: EntrySource.TRIP, _sum: { amount: null } },
      ]);

      const rows = await repository.sumIncomeBySource(USER, {
        ...filter,
        nature: EntryNature.EXPENSE,
      });

      expect(rows.map(row => row.total.toNumber())).toEqual([9, 0]);
      expect(entries.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { ...STATEMENT, nature: EntryNature.INCOME },
        }),
      );
    });
  });

  it.each([
    [
      'findByPurchaseInvoice',
      { userId: USER, purchaseInvoiceId: 'origin-1', deletedAt: null },
    ],
    [
      'findByServiceInvoice',
      { userId: USER, serviceInvoiceId: 'origin-1', deletedAt: null },
    ],
    // Deleted or not: `trip_id` is unique, so a deleted entry is revived.
    ['findByTrip', { userId: USER, tripId: 'origin-1' }],
  ] as const)(
    '%s looks in the transaction it is given',
    async (method, where) => {
      await repository[method](USER, 'origin-1');
      await repository[method](USER, 'origin-1', tx as never);

      const call: unknown = expect.objectContaining({ where });
      expect(entries.findFirst).toHaveBeenCalledTimes(1);
      expect(entries.findFirst).toHaveBeenCalledWith(call);
      expect(tx.financialEntry.findFirst).toHaveBeenCalledWith(call);
    },
  );

  it('updates an automatic entry by id', async () => {
    await repository.updateById(ENTRY, { description: 'x' }, tx as never);
    await repository.updateById(ENTRY, { description: 'x' });

    const call = {
      where: { id: ENTRY },
      data: { description: 'x' },
      select: { id: true },
    };
    expect(tx.financialEntry.update).toHaveBeenCalledWith(call);
    expect(entries.update).toHaveBeenCalledWith(call);
  });

  it('updates the entry of a note unless it was deleted', async () => {
    await repository.updateByServiceInvoice(USER, 'note-1', {
      scope: 'PERSONAL',
    });

    expect(entries.updateMany).toHaveBeenCalledWith({
      where: { userId: USER, serviceInvoiceId: 'note-1', deletedAt: null },
      data: { scope: 'PERSONAL' },
    });
  });

  it('finds an entry of the user, with or without the deleted ones', async () => {
    await repository.findForUser(USER, ENTRY);
    await repository.findOwned(USER, ENTRY);

    expect(entries.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { id: ENTRY, userId: USER } }),
    );
    expect(entries.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: ENTRY, userId: USER, deletedAt: null },
      }),
    );
  });

  it('says whether an id is taken, whoever owns it', async () => {
    await expect(repository.idIsTaken(ENTRY)).resolves.toBe(false);

    entries.findUnique.mockResolvedValue({ id: ENTRY });
    await expect(repository.idIsTaken(ENTRY)).resolves.toBe(true);
  });

  it('creates in the transaction it is given', async () => {
    await repository.create({ id: ENTRY } as never, tx as never);

    expect(tx.financialEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { id: ENTRY } }),
    );
    expect(entries.create).not.toHaveBeenCalled();
  });

  it('updates a live entry of the user and answers it', async () => {
    await expect(
      repository.update(USER, ENTRY, { description: 'x' }),
    ).resolves.toEqual({ id: ENTRY });
    expect(entries.updateMany).toHaveBeenCalledWith({
      where: { id: ENTRY, userId: USER, deletedAt: null },
      data: { description: 'x' },
    });
  });

  it('fails when there was no live entry of the user to update', async () => {
    entries.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      repository.update(USER, ENTRY, { description: 'x' }),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    expect(entries.findFirstOrThrow).not.toHaveBeenCalled();
  });
});
