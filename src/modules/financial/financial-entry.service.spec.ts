import { EntryNature, EntryScope, EntrySource, Prisma } from '@prisma/client';

import { CreateFinancialEntryDto } from './dto/create-financial-entry.dto';
import { QueryFinancialEntryDto } from './dto/query-financial-entry.dto';
import { SyncFinancialEntryDto } from './dto/sync-financial-entry.dto';
import { StatementRow } from './financial-entry.repository';
import {
  FinancialEntryService,
  toStatementEntry,
} from './financial-entry.service';
import { DomainError } from '../../shared/errors/domain-error';

const row = (overrides: Partial<StatementRow> = {}): StatementRow => ({
  id: 'entry-1',
  nature: EntryNature.INCOME,
  description: 'Procedure',
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
  },
  ...overrides,
});

describe('FinancialEntryService', () => {
  let repository: { findStatement: jest.Mock };
  let service: FinancialEntryService;

  beforeEach(() => {
    repository = { findStatement: jest.fn().mockResolvedValue([]) };
    service = new FinancialEntryService(repository as never, {} as never);
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
});

describe('FinancialEntryService manual writes', () => {
  const category = {
    id: 'cat-1',
    nature: EntryNature.INCOME,
    defaultScope: EntryScope.PROFESSIONAL,
  };
  let repository: {
    findById: jest.Mock;
    findOwned: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  let categories: { findForUser: jest.Mock };
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
      findById: jest.fn().mockResolvedValue(null),
      findOwned: jest.fn(),
      create: jest.fn().mockResolvedValue(row()),
      update: jest.fn(),
    };
    categories = { findForUser: jest.fn().mockResolvedValue(category) };
    service = new FinancialEntryService(
      repository as never,
      categories as never,
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
    repository.findById.mockResolvedValue({
      ...row(),
      userId: 'user-1',
      deletedAt: null,
      categoryId: 'cat-1',
    });

    const result = await service.create('user-1', dto());

    expect(result.id).toBe('entry-1');
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rejects an id that already belongs to someone else', async () => {
    repository.findById.mockResolvedValue({
      ...row(),
      userId: 'user-2',
      deletedAt: null,
      categoryId: 'cat-1',
    });

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
    repository.findById.mockImplementation(() => stored);
    repository.create.mockImplementation(() => {
      stored = {
        ...row(),
        userId: 'user-1',
        deletedAt: null,
        categoryId: 'cat-1',
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

  it('conflicts when the server copy is newer than the operation', async () => {
    repository.findById.mockResolvedValue({
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
    repository.findById.mockResolvedValue({
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
        result: 'rejected',
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
