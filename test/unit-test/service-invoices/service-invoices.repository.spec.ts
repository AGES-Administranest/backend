import { Prisma } from '@prisma/client';

import { ServiceInvoicesRepository } from '../../../src/modules/service-invoices/service-invoices.repository';
import { periodFromIsoDates } from '../../../src/shared/dates/period';

const USER = 'user-1';
const NOTE = 'note-1';
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
const anyDate = expect.any(Date) as Date;

const noteClient = () => ({
  count: jest.fn().mockResolvedValue(2),
  aggregate: jest.fn(),
  findMany: jest.fn().mockResolvedValue([]),
  findFirst: jest.fn().mockResolvedValue(null),
  findUniqueOrThrow: jest.fn().mockResolvedValue({ id: NOTE }),
  create: jest.fn().mockResolvedValue({ id: NOTE }),
  update: jest.fn().mockResolvedValue({ id: NOTE }),
  updateMany: jest.fn().mockResolvedValue({ count: 1 }),
});

describe('ServiceInvoicesRepository', () => {
  let notes: ReturnType<typeof noteClient>;
  let tx: { serviceInvoice: ReturnType<typeof noteClient> };
  let client: { findFirst: jest.Mock };
  let queryRaw: jest.Mock;
  let repository: ServiceInvoicesRepository;

  beforeEach(() => {
    notes = noteClient();
    tx = { serviceInvoice: noteClient() };
    client = { findFirst: jest.fn().mockResolvedValue(null) };
    queryRaw = jest.fn();
    repository = new ServiceInvoicesRepository({
      serviceInvoice: notes,
      client,
      $queryRaw: queryRaw,
      $transaction: (work: (inside: unknown) => unknown) => work(tx),
    } as never);
  });

  it('counts the confirmed notes of the period', async () => {
    await expect(
      repository.countConfirmedInPeriod(USER, OCTOBER),
    ).resolves.toBe(2);
    expect(notes.count).toHaveBeenCalledWith({ where: CONFIRMED_IN_OCTOBER });
  });

  describe('tax package', () => {
    it('adds up the stored notes and counts those without a file', async () => {
      notes.aggregate.mockResolvedValue({
        _count: { _all: 3 },
        _sum: { amount: new Prisma.Decimal('99.90'), fileBytesSize: 2048 },
      });

      await expect(
        repository.summarizeTaxPackage(USER, OCTOBER),
      ).resolves.toEqual({
        count: 3,
        totalAmount: 99.9,
        bytesSize: 2048,
        missingFiles: 2,
      });
      expect(notes.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            ...CONFIRMED_IN_OCTOBER,
            fileUrl: { not: null },
            uploadedAt: { not: null },
          },
        }),
      );
      expect(notes.count).toHaveBeenCalledWith({
        where: {
          ...CONFIRMED_IN_OCTOBER,
          OR: [{ fileUrl: null }, { uploadedAt: null }],
        },
      });
    });

    it('is zero when there is nothing to add up', async () => {
      notes.aggregate.mockResolvedValue({
        _count: { _all: 0 },
        _sum: { amount: null, fileBytesSize: null },
      });

      await expect(
        repository.summarizeTaxPackage(USER, OCTOBER),
      ).resolves.toMatchObject({ totalAmount: 0, bytesSize: 0 });
    });

    it('lists the stored notes oldest first, bounded', async () => {
      await repository.findTaxPackageNotes(USER, OCTOBER, 5);

      expect(notes.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            ...CONFIRMED_IN_OCTOBER,
            fileUrl: { not: null },
            uploadedAt: { not: null },
          },
          orderBy: [{ issueDate: 'asc' }, { id: 'asc' }],
          take: 5,
        }),
      );
    });
  });

  it('finds a live note and a client summary only for the owner', async () => {
    await repository.findByIdAndUser(NOTE, USER);
    await repository.findClientSummary('client-1', USER);

    expect(notes.findFirst).toHaveBeenCalledWith({
      where: { id: NOTE, userId: USER, deletedAt: null },
    });
    expect(client.findFirst).toHaveBeenCalledWith({
      where: { id: 'client-1', userId: USER },
      select: { id: true, name: true, taxId: true },
    });
  });

  describe('findConfirmedPage', () => {
    const matchingSql = () =>
      (queryRaw.mock.calls[0] as [unknown, Prisma.Sql])[1];

    beforeEach(() => {
      queryRaw
        .mockResolvedValueOnce([{ id: 'b' }, { id: 'gone' }, { id: 'a' }])
        .mockResolvedValueOnce([{ total: 12n }]);
      notes.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    });

    it('keeps the order of the search and drops rows gone meanwhile', async () => {
      await expect(
        repository.findConfirmedPage(USER, null, 0, 10),
      ).resolves.toEqual({ notes: [{ id: 'b' }, { id: 'a' }], total: 12 });
      expect(notes.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['b', 'gone', 'a'] }, userId: USER },
        }),
      );
    });

    it('filters by owner alone when there is no search', async () => {
      await repository.findConfirmedPage(USER, null, 0, 10);

      expect(matchingSql().values).toEqual([USER]);
    });

    it('searches name and number, escaping the wildcards of the user', async () => {
      await repository.findConfirmedPage(
        USER,
        { text: '50%', dateDigits: null } as never,
        0,
        10,
      );

      expect(matchingSql().values).toEqual([USER, '%50\\%%', '%50\\%%']);
      expect(matchingSql().sql).not.toContain('to_char');
    });

    it('also searches the date when the text holds digits', async () => {
      await repository.findConfirmedPage(
        USER,
        { text: '22/04', dateDigits: '2204' },
        0,
        10,
      );

      expect(matchingSql().values).toContain('%2204%');
      expect(matchingSql().sql).toContain('to_char');
    });

    it('answers zero when nothing was counted', async () => {
      queryRaw.mockReset().mockResolvedValue([]);
      notes.findMany.mockResolvedValue([]);

      await expect(
        repository.findConfirmedPage(USER, null, 0, 10),
      ).resolves.toEqual({ notes: [], total: 0 });
    });
  });

  describe('findConfirmedForReport', () => {
    const whereOf = () =>
      (notes.findMany.mock.calls[0] as [{ where: unknown }])[0].where;
    const base = { userId: USER, deletedAt: null, status: 'CONFIRMED' };

    it('has no filter besides the owner by default', async () => {
      await repository.findConfirmedForReport(USER, {}, 0, 10);

      expect(whereOf()).toEqual(base);
    });

    it('applies an open-ended range and the escaped name', async () => {
      const issuedFrom = new Date('2026-10-01');

      await repository.findConfirmedForReport(
        USER,
        { issuedFrom, search: 'a_b' },
        0,
        10,
      );

      expect(whereOf()).toEqual({
        ...base,
        issueDate: { gte: issuedFrom, lte: undefined },
        client: { name: { contains: 'a\\_b', mode: 'insensitive' } },
      });
    });
  });

  it('finds the live note that holds a file', async () => {
    await expect(
      repository.findIdByFileHash(USER, 'hash'),
    ).resolves.toBeUndefined();

    notes.findFirst.mockResolvedValue({ id: NOTE });
    await expect(repository.findIdByFileHash(USER, 'hash')).resolves.toBe(NOTE);
    expect(notes.findFirst).toHaveBeenLastCalledWith({
      where: { userId: USER, fileHash: 'hash', deletedAt: null },
      select: { id: true },
    });
  });

  describe('findDuplicate', () => {
    const alternatives = () =>
      (notes.findFirst.mock.calls[0] as [{ where: { OR: unknown } }])[0].where
        .OR;

    it('compares by amount and date, never with itself or a draft', async () => {
      const amountAndDate = { amount: 10, issueDate: new Date() };

      await repository.findDuplicate(USER, NOTE, {
        amountAndDate,
      } as never);

      expect(alternatives()).toEqual([amountAndDate]);
      expect(notes.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: USER,
            id: { not: NOTE },
            status: 'CONFIRMED',
            deletedAt: null,
          }) as unknown,
        }),
      );
    });

    it.each([
      [{ clientId: 'client-1' }, [{ clientId: 'client-1' }]],
      [{ takerTaxId: '123' }, [{ takerTaxId: '123' }]],
      [
        { clientId: 'client-1', takerTaxId: '123' },
        [{ clientId: 'client-1' }, { takerTaxId: '123' }],
      ],
    ])('compares the number within the same taker %j', async (taker, or) => {
      await repository.findDuplicate(USER, NOTE, {
        numberAndTaker: { number: '10', ...taker },
      });

      expect(alternatives()).toEqual([{ number: '10', OR: or }]);
    });
  });

  it.each([
    [1, true],
    [0, false],
  ])('says whether the draft was written (%i row)', async (count, written) => {
    notes.updateMany.mockResolvedValue({ count });

    await expect(
      repository.updateDraft(NOTE, USER, { number: '10' }),
    ).resolves.toBe(written);
    expect(notes.updateMany).toHaveBeenCalledWith({
      where: { id: NOTE, userId: USER, status: 'DRAFT', deletedAt: null },
      data: { number: '10', updatedAt: anyDate },
    });
  });

  it('creates and updates by id', async () => {
    await repository.create({ id: NOTE } as never);
    await repository.update(NOTE, { number: '10' });

    expect(notes.create).toHaveBeenCalledWith({ data: { id: NOTE } });
    expect(notes.update).toHaveBeenCalledWith({
      where: { id: NOTE },
      data: { number: '10' },
    });
  });

  describe('status transitions and the income entry', () => {
    it('confirms a draft and records its income in the same transaction', async () => {
      const recordIncome = jest.fn().mockResolvedValue('entry-1');

      await expect(
        repository.confirmDraft(NOTE, USER, { number: '10' }, recordIncome),
      ).resolves.toBe('entry-1');

      expect(tx.serviceInvoice.updateMany).toHaveBeenCalledWith({
        where: { id: NOTE, userId: USER, status: 'DRAFT', deletedAt: null },
        data: {
          number: '10',
          status: 'CONFIRMED',
          reviewedAt: anyDate,
          updatedAt: anyDate,
        },
      });
      expect(recordIncome).toHaveBeenCalledWith(tx, { id: NOTE });
    });

    it('edits a confirmed note and adjusts its income', async () => {
      const adjustIncome = jest.fn();

      await expect(
        repository.updateConfirmed(NOTE, USER, { number: '1' }, adjustIncome),
      ).resolves.toBe(true);
      expect(adjustIncome).toHaveBeenCalledWith(tx, { id: NOTE });
    });

    it('soft deletes a confirmed note and removes its income', async () => {
      const removeIncome = jest.fn();

      await expect(
        repository.deleteConfirmed(NOTE, USER, removeIncome),
      ).resolves.toBe(true);

      expect(tx.serviceInvoice.updateMany).toHaveBeenCalledWith({
        where: { id: NOTE, userId: USER, status: 'CONFIRMED', deletedAt: null },
        data: { deletedAt: anyDate, updatedAt: anyDate },
      });
      expect(removeIncome).toHaveBeenCalledWith(tx, { id: NOTE });
    });

    it('never touches the income when the note was not in that status', async () => {
      tx.serviceInvoice.updateMany.mockResolvedValue({ count: 0 });
      const income = jest.fn();

      await expect(
        repository.confirmDraft(NOTE, USER, {}, income),
      ).resolves.toBeNull();
      await expect(
        repository.updateConfirmed(NOTE, USER, {}, income),
      ).resolves.toBe(false);
      await expect(
        repository.deleteConfirmed(NOTE, USER, income),
      ).resolves.toBe(false);
      expect(income).not.toHaveBeenCalled();
    });
  });

  it.each([
    [1, true],
    [0, false],
  ])('claims a reading once (%i row)', async (count, claimed) => {
    const staleBefore = new Date('2026-10-01');
    notes.updateMany.mockResolvedValue({ count });

    await expect(repository.claimExtraction(NOTE, staleBefore)).resolves.toBe(
      claimed,
    );
    expect(notes.updateMany).toHaveBeenCalledWith({
      where: {
        id: NOTE,
        status: 'DRAFT',
        deletedAt: null,
        OR: [
          { extractionStatus: { in: ['PENDING', 'FAILED'] } },
          { extractionStatus: 'PROCESSING', updatedAt: { lt: staleBefore } },
        ],
      },
      data: {
        extractionStatus: 'PROCESSING',
        failureReason: null,
        updatedAt: anyDate,
      },
    });
  });
});
