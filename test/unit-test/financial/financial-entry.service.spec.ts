import { EntryNature, EntryScope, EntrySource, Prisma } from '@prisma/client';

import { CreateFinancialEntryDto } from '../../../src/modules/financial/dto/create-financial-entry.dto';
import { QueryFinancialEntryDto } from '../../../src/modules/financial/dto/query-financial-entry.dto';
import { SyncFinancialEntryDto } from '../../../src/modules/financial/dto/sync-financial-entry.dto';
import { StatementRow } from '../../../src/modules/financial/financial-entry.repository';
import {
  FinancialEntryService,
  toStatementEntry,
} from '../../../src/modules/financial/financial-entry.service';
import { DomainError } from '../../../src/shared/errors/domain-error';

const row = (overrides: Partial<StatementRow> = {}): StatementRow => ({
  id: 'entry-1',
  nature: EntryNature.INCOME,
  description: 'Fee',
  scope: EntryScope.PROFESSIONAL,
  amount: new Prisma.Decimal('10.00'),
  accrualDate: new Date('2026-03-15T12:00:00.000Z'),
  source: EntrySource.MANUAL,
  appointmentId: null,
  serviceInvoiceId: null,
  purchaseInvoiceId: null,
  tripId: null,
  category: {
    id: 'cat-1',
    name: 'Professional fees',
    defaultScope: EntryScope.PROFESSIONAL,
    userId: null,
  },
  ...overrides,
});

describe('FinancialEntryService', () => {
  let repository: { findStatement: jest.Mock };
  let service: FinancialEntryService;

  beforeEach(() => {
    repository = { findStatement: jest.fn().mockResolvedValue([]) };
    service = new FinancialEntryService(
      repository as never,
      {} as never,
      {} as never,
    );
  });

  it('uses the current UTC month when month and year are absent', async () => {
    const query = new QueryFinancialEntryDto();
    await service.findAll('user-1', query);

    const now = new Date();
    expect(repository.findStatement).toHaveBeenCalledWith(
      'user-1',
      {
        from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
        to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
        nature: undefined,
        scope: undefined,
        categoryId: undefined,
      },
      0,
      50,
    );
  });

  it('combines month, nature, scope and category and pages forward', async () => {
    const query = Object.assign(new QueryFinancialEntryDto(), {
      month: 3,
      year: 2026,
      nature: EntryNature.EXPENSE,
      scope: EntryScope.PERSONAL,
      categoryId: 'cat-9',
      page: 2,
      limit: 20,
    });

    await service.findAll('user-1', query);

    expect(repository.findStatement).toHaveBeenCalledWith(
      'user-1',
      {
        from: new Date(Date.UTC(2026, 2, 1)),
        to: new Date(Date.UTC(2026, 3, 1)),
        nature: EntryNature.EXPENSE,
        scope: EntryScope.PERSONAL,
        categoryId: 'cat-9',
      },
      20,
      20,
    );
  });

  it('returns the filled origin id and nothing for a manual entry', () => {
    expect(toStatementEntry(row()).origin).toEqual({
      type: EntrySource.MANUAL,
      id: null,
    });
    expect(
      toStatementEntry(
        row({
          source: EntrySource.APPOINTMENT,
          appointmentId: 'appt-1',
        }),
      ).origin,
    ).toEqual({ type: EntrySource.APPOINTMENT, id: 'appt-1' });
  });

  it('flags a default category and a user one with the same name, without the owner', () => {
    expect(toStatementEntry(row()).category).toEqual({
      id: 'cat-1',
      name: 'Professional fees',
      scope: EntryScope.PROFESSIONAL,
      isDefault: true,
    });
    expect(
      toStatementEntry(
        row({
          category: {
            id: 'cat-2',
            name: 'Professional fees',
            defaultScope: EntryScope.PERSONAL,
            userId: 'user-1',
          },
        }),
      ).category,
    ).toEqual({
      id: 'cat-2',
      name: 'Professional fees',
      scope: EntryScope.PERSONAL,
      isDefault: false,
    });
  });
});

describe('FinancialEntryService manual writes', () => {
  const category = {
    id: 'cat-1',
    nature: EntryNature.INCOME,
    defaultScope: EntryScope.PROFESSIONAL,
  };
  let repository: {
    findForUser: jest.Mock;
    idIsTaken: jest.Mock;
    findOwned: jest.Mock;
    findByPurchaseInvoice: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  let categories: { findForUser: jest.Mock; findDefault: jest.Mock };
  let service: FinancialEntryService;

  const dto = (): CreateFinancialEntryDto =>
    Object.assign(new CreateFinancialEntryDto(), {
      id: 'entry-1',
      nature: EntryNature.INCOME,
      description: 'Fee',
      amount: 10,
      accrualDate: '2026-03-15T12:00:00.000Z',
      categoryId: 'cat-1',
    });

  beforeEach(() => {
    repository = {
      findForUser: jest.fn().mockResolvedValue(null),
      idIsTaken: jest.fn().mockResolvedValue(false),
      findOwned: jest.fn(),
      findByPurchaseInvoice: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(row()),
      update: jest.fn(),
    };
    categories = {
      findForUser: jest.fn().mockResolvedValue(category),
      findDefault: jest.fn(),
    };
    service = new FinancialEntryService(
      repository as never,
      categories as never,
      {} as never,
    );
  });

  it('inherits the category scope and stores a manual entry', async () => {
    await service.create('user-1', dto());

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        scope: EntryScope.PROFESSIONAL,
        source: EntrySource.MANUAL,
      }),
    );
  });

  it('returns the existing manual entry when the same id is sent again', async () => {
    repository.findForUser.mockResolvedValue({
      ...row(),
      description: 'Fee',
      userId: 'user-1',
      deletedAt: null,
      categoryId: 'cat-1',
    });

    const result = await service.create('user-1', dto());

    expect(result.id).toBe('entry-1');
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rejects a replay whose amount differs', async () => {
    repository.findForUser.mockResolvedValue({
      ...row(),
      description: 'Fee',
      userId: 'user-1',
      deletedAt: null,
      categoryId: 'cat-1',
    });

    await expect(
      service.create('user-1', { ...dto(), amount: 99 }),
    ).rejects.toMatchObject({ code: 'FINANCIAL_ENTRY_ID_CONFLICT' });
  });

  it('rejects an id that already belongs to someone else', async () => {
    repository.findForUser.mockResolvedValue(null);
    repository.idIsTaken.mockResolvedValue(true);

    await expect(service.create('user-1', dto())).rejects.toMatchObject({
      code: 'FINANCIAL_ENTRY_ID_CONFLICT',
    });
  });

  it('rejects a category whose nature does not match', async () => {
    categories.findForUser.mockResolvedValue({
      ...category,
      nature: EntryNature.EXPENSE,
    });

    await expect(service.create('user-1', dto())).rejects.toBeInstanceOf(
      DomainError,
    );
  });

  it('updates description of an automatic entry and refuses amount', async () => {
    const automatic = {
      ...row({
        source: EntrySource.APPOINTMENT,
        appointmentId: 'appt-1',
      }),
      categoryId: 'cat-1',
    };
    repository.findOwned.mockResolvedValue(automatic);
    repository.update.mockResolvedValue(automatic);

    await service.update('user-1', 'entry-1', { description: 'Note' });
    expect(repository.update).toHaveBeenCalledWith(
      'user-1',
      'entry-1',
      expect.objectContaining({ description: 'Note' }),
    );

    await expect(
      service.update('user-1', 'entry-1', { amount: 3 }),
    ).rejects.toMatchObject({
      code: 'FINANCIAL_ENTRY_CONTROLLED_BY_ORIGIN',
      kind: 'INVALID_INPUT',
    });
  });

  it('applies a create once and ignores the same id sent again', async () => {
    let stored: Record<string, unknown> | null = null;
    repository.findForUser.mockImplementation(() => stored);
    repository.create.mockImplementation(() => {
      stored = {
        ...row(),
        userId: 'user-1',
        deletedAt: null,
        categoryId: 'cat-1',
        accrualDate: new Date('2026-04-01T00:00:00.000Z'),
      };
      return row();
    });

    const operation = Object.assign(new SyncFinancialEntryDto(), {
      id: 'entry-1',
      operation: 'create',
      occurredAt: '2026-04-01T00:00:00.000Z',
      nature: EntryNature.INCOME,
      description: 'Fee',
      amount: 10,
      accrualDate: '2026-04-01T00:00:00.000Z',
      categoryId: 'cat-1',
    });

    await expect(
      service.sync('user-1', [operation, operation]),
    ).resolves.toEqual([
      { id: 'entry-1', result: 'applied' },
      { id: 'entry-1', result: 'ignored' },
    ]);
    expect(repository.create).toHaveBeenCalledTimes(1);
  });

  it('rejects an operation dated beyond the ten-minute clock tolerance', async () => {
    const operation = Object.assign(new SyncFinancialEntryDto(), {
      id: 'entry-1',
      operation: 'delete',
      occurredAt: new Date(Date.now() + 11 * 60 * 1000).toISOString(),
    });

    await expect(service.sync('user-1', [operation])).rejects.toMatchObject({
      code: 'FINANCIAL_ENTRY_DATE_IN_FUTURE',
    });
    expect(repository.findForUser).not.toHaveBeenCalled();
  });

  it('applies operations by instant, not by the date string', async () => {
    repository.findForUser.mockResolvedValue(null);
    repository.create.mockResolvedValue(row());

    const laterInUtc = Object.assign(new SyncFinancialEntryDto(), {
      id: 'later',
      operation: 'create',
      occurredAt: '2026-04-01T20:00:00.000-03:00',
      nature: EntryNature.INCOME,
      description: 'Fee',
      amount: 10,
      accrualDate: '2026-04-01T00:00:00.000Z',
      categoryId: 'cat-1',
    });
    const earlierInUtc = Object.assign(new SyncFinancialEntryDto(), {
      id: 'earlier',
      operation: 'create',
      occurredAt: '2026-04-01T22:00:00.000Z',
      nature: EntryNature.INCOME,
      description: 'Fee',
      amount: 10,
      accrualDate: '2026-04-01T00:00:00.000Z',
      categoryId: 'cat-1',
    });

    await service.sync('user-1', [laterInUtc, earlierInUtc]);

    expect(repository.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'earlier' }),
    );
    expect(repository.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'later' }),
    );
  });

  it('conflicts when the server copy is newer than the operation', async () => {
    repository.findForUser.mockResolvedValue({
      ...row(),
      userId: 'user-1',
      deletedAt: null,
      categoryId: 'cat-1',
      updatedAt: new Date('2026-04-02T00:00:00.000Z'),
    });

    const operation = Object.assign(new SyncFinancialEntryDto(), {
      id: 'entry-1',
      operation: 'update',
      occurredAt: '2026-04-01T00:00:00.000Z',
      description: 'Stale',
    });

    await expect(service.sync('user-1', [operation])).resolves.toEqual([
      {
        id: 'entry-1',
        result: 'conflict',
        code: 'FINANCIAL_ENTRY_SYNC_CONFLICT',
      },
    ]);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('rejects an offline change to an amount controlled by the origin', async () => {
    repository.findForUser.mockResolvedValue({
      ...row({
        source: EntrySource.APPOINTMENT,
        appointmentId: 'appt-1',
      }),
      userId: 'user-1',
      deletedAt: null,
      categoryId: 'cat-1',
      updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    });
    repository.findOwned.mockResolvedValue({
      ...row({
        source: EntrySource.APPOINTMENT,
        appointmentId: 'appt-1',
      }),
      categoryId: 'cat-1',
    });

    const operation = Object.assign(new SyncFinancialEntryDto(), {
      id: 'entry-1',
      operation: 'update',
      occurredAt: '2026-04-01T00:00:00.000Z',
      amount: 3,
    });

    await expect(service.sync('user-1', [operation])).resolves.toEqual([
      {
        id: 'entry-1',
        result: 'conflict',
        code: 'FINANCIAL_ENTRY_CONTROLLED_BY_ORIGIN',
      },
    ]);
  });

  it('posts one expense for a purchase invoice and ignores a second call', async () => {
    categories.findDefault = jest.fn().mockResolvedValue({
      id: 'supplies',
      defaultScope: EntryScope.PROFESSIONAL,
    });
    repository.findByPurchaseInvoice = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'entry-9' });

    const input = {
      userId: 'user-1',
      purchaseInvoiceId: 'inv-1',
      amount: new Prisma.Decimal('40.00'),
      issueDate: new Date('2026-08-12T00:00:00.000Z'),
      number: '4521',
    };
    await service.recordPurchaseInvoice(input);
    await service.recordPurchaseInvoice(input);

    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        nature: EntryNature.EXPENSE,
        source: EntrySource.PURCHASE_INVOICE,
        purchaseInvoiceId: 'inv-1',
        description: 'Invoice 4521',
        categoryId: 'supplies',
      }),
      undefined,
    );
  });

  it('refuses to delete an automatic entry and names its origin', async () => {
    repository.findOwned.mockResolvedValue({
      ...row({
        source: EntrySource.APPOINTMENT,
        appointmentId: 'appt-1',
      }),
      categoryId: 'cat-1',
    });

    await expect(service.remove('user-1', 'entry-1')).rejects.toMatchObject({
      code: 'FINANCIAL_ENTRY_DELETE_VIA_ORIGIN',
      kind: 'CONFLICT',
      details: { type: EntrySource.APPOINTMENT, id: 'appt-1' },
    });
  });
});

describe('FinancialEntryService, trip expenses', () => {
  const tx = { tx: true };
  let repository: {
    findByTrip: jest.Mock;
    updateById: jest.Mock;
    create: jest.Mock;
  };
  let categories: { findDefault: jest.Mock };
  let service: FinancialEntryService;

  const input = (amount: string) => ({
    userId: 'user-1',
    tripId: 'trip-1',
    amount: new Prisma.Decimal(amount),
    occurredOn: new Date('2026-10-18T00:00:00.000Z'),
    description: 'Casa → Clínica',
  });

  beforeEach(() => {
    repository = {
      findByTrip: jest.fn().mockResolvedValue(null),
      updateById: jest.fn().mockResolvedValue(undefined),
      create: jest.fn().mockResolvedValue(row()),
    };
    categories = {
      findDefault: jest.fn().mockResolvedValue({
        id: 'travel',
        defaultScope: EntryScope.PROFESSIONAL,
      }),
    };
    service = new FinancialEntryService(
      repository as never,
      categories as never,
      {} as never,
    );
  });

  describe('recordTrip', () => {
    it('posts a professional expense under Travel, in the trip transaction', async () => {
      await service.recordTrip(input('141.57'), tx as never);

      expect(repository.findByTrip).toHaveBeenCalledWith(
        'user-1',
        'trip-1',
        tx,
      );
      expect(categories.findDefault).toHaveBeenCalledWith(
        'Travel',
        EntryNature.EXPENSE,
      );
      const [data, client] = repository.create.mock.calls[0] as [
        Prisma.FinancialEntryUncheckedCreateInput,
        unknown,
      ];
      expect(client).toBe(tx);
      expect(data).toEqual({
        userId: 'user-1',
        nature: EntryNature.EXPENSE,
        scope: EntryScope.PROFESSIONAL,
        categoryId: 'travel',
        description: 'Casa → Clínica',
        amount: new Prisma.Decimal('141.57'),
        accrualDate: new Date('2026-10-18T00:00:00.000Z'),
        source: EntrySource.TRIP,
        tripId: 'trip-1',
      });
    });

    it('updates the amount, date and description of the existing expense', async () => {
      repository.findByTrip.mockResolvedValue({
        id: 'entry-1',
        deletedAt: null,
      });

      await service.recordTrip(input('47.19'), tx as never);

      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.updateById).toHaveBeenCalledWith(
        'entry-1',
        {
          amount: new Prisma.Decimal('47.19'),
          accrualDate: new Date('2026-10-18T00:00:00.000Z'),
          description: 'Casa → Clínica',
          deletedAt: null,
        },
        tx,
      );
    });

    it('revives a deleted expense when the cost rises from zero', async () => {
      repository.findByTrip.mockResolvedValue({
        id: 'entry-1',
        deletedAt: new Date('2026-10-18T12:00:00.000Z'),
      });

      await service.recordTrip(input('0.01'), tx as never);

      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.updateById).toHaveBeenCalledWith(
        'entry-1',
        expect.objectContaining({ deletedAt: null }),
        tx,
      );
    });

    it('removes the expense, never setting it to zero, when the cost drops to zero', async () => {
      repository.findByTrip.mockResolvedValue({
        id: 'entry-1',
        deletedAt: null,
      });

      await service.recordTrip(input('0'), tx as never);

      const [id, data, client] = repository.updateById.mock.calls[0] as [
        string,
        { deletedAt: unknown; amount?: unknown },
        unknown,
      ];
      expect(id).toBe('entry-1');
      expect(data.deletedAt).toBeInstanceOf(Date);
      expect(data).not.toHaveProperty('amount');
      expect(client).toBe(tx);
    });

    it.each([
      ['no expense', null],
      ['an already removed one', { id: 'entry-1', deletedAt: new Date() }],
    ])('posts nothing for a zero cost with %s', async (_case, existing) => {
      repository.findByTrip.mockResolvedValue(existing);

      await service.recordTrip(input('0.00'), tx as never);

      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.updateById).not.toHaveBeenCalled();
    });

    it('fails when the Travel category is not seeded', async () => {
      categories.findDefault.mockResolvedValue(null);

      await expect(
        service.recordTrip(input('141.57'), tx as never),
      ).rejects.toMatchObject({
        kind: 'INVALID_INPUT',
        code: 'FINANCIAL_CATEGORY_NOT_SEEDED',
      } satisfies Partial<DomainError>);
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('removeTripEntry', () => {
    it('soft-deletes the expense in the trip transaction', async () => {
      repository.findByTrip.mockResolvedValue({
        id: 'entry-1',
        deletedAt: null,
      });

      await service.removeTripEntry('user-1', 'trip-1', tx as never);

      const [id, data, client] = repository.updateById.mock.calls[0] as [
        string,
        { deletedAt: unknown },
        unknown,
      ];
      expect(id).toBe('entry-1');
      expect(Object.keys(data)).toEqual(['deletedAt']);
      expect(data.deletedAt).toBeInstanceOf(Date);
      expect(client).toBe(tx);
    });

    it.each([
      ['no expense', null],
      ['an already removed one', { id: 'entry-1', deletedAt: new Date() }],
    ])('does nothing for a trip with %s', async (_case, existing) => {
      repository.findByTrip.mockResolvedValue(existing);

      await service.removeTripEntry('user-1', 'trip-1', tx as never);

      expect(repository.updateById).not.toHaveBeenCalled();
    });
  });
});
