import { EntryNature, EntryScope, EntrySource, Prisma } from '@prisma/client';

import { UniqueConstraintError } from '../../../src/infra/prisma/prisma-errors';
import { CreateFinancialEntryDto } from '../../../src/modules/financial/dto/create-financial-entry.dto';
import { SyncFinancialEntryDto } from '../../../src/modules/financial/dto/sync-financial-entry.dto';
import { FinancialEntryService } from '../../../src/modules/financial/financial-entry.service';

const USER = 'user-1';
const ID = 'entry-1';
const ACCRUAL = '2026-03-15T12:00:00.000Z';
const STORED_AT = new Date('2026-03-16T12:00:00.000Z');
const AFTER = '2026-03-17T12:00:00.000Z';

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: ID,
  userId: USER,
  nature: EntryNature.INCOME,
  description: 'Fee',
  scope: EntryScope.PROFESSIONAL,
  amount: new Prisma.Decimal(10),
  accrualDate: new Date(ACCRUAL),
  source: EntrySource.MANUAL,
  appointmentId: null,
  serviceInvoiceId: null,
  purchaseInvoiceId: null,
  tripId: null,
  categoryId: 'cat-1',
  deletedAt: null,
  updatedAt: STORED_AT,
  category: {
    id: 'cat-1',
    name: 'Fees',
    defaultScope: EntryScope.PROFESSIONAL,
    userId: null,
  },
  ...overrides,
});

const payload: CreateFinancialEntryDto = {
  id: ID,
  nature: EntryNature.INCOME,
  description: 'Fee',
  amount: 10,
  accrualDate: ACCRUAL,
  categoryId: 'cat-1',
};

describe('FinancialEntryService writes', () => {
  let repository: Record<string, jest.Mock>;
  let categories: { findForUser: jest.Mock; findDefault: jest.Mock };
  let service: FinancialEntryService;

  beforeEach(() => {
    repository = {
      countInPeriod: jest.fn().mockResolvedValue(4),
      findForUser: jest.fn().mockResolvedValue(null),
      idIsTaken: jest.fn().mockResolvedValue(false),
      findOwned: jest.fn().mockResolvedValue(entry()),
      findByPurchaseInvoice: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(entry()),
      update: jest.fn().mockResolvedValue(entry()),
    };
    categories = {
      findForUser: jest.fn().mockResolvedValue({
        id: 'cat-1',
        nature: EntryNature.INCOME,
        defaultScope: EntryScope.PROFESSIONAL,
      }),
      findDefault: jest.fn().mockResolvedValue(null),
    };
    service = new FinancialEntryService(
      repository as never,
      categories as never,
      {} as never,
    );
  });

  it('counts for the given user', async () => {
    const period = {} as never;

    await expect(service.countInPeriod(USER, period)).resolves.toBe(4);
    expect(repository.countInPeriod).toHaveBeenCalledWith(USER, period);
  });

  describe('create racing its own retry', () => {
    const winner = (row: unknown) => {
      repository.create.mockRejectedValue(new UniqueConstraintError(['id']));
      repository.findForUser
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(row);
    };

    it('answers the entry the other request stored', async () => {
      winner(entry());

      await expect(service.create(USER, payload)).resolves.toMatchObject({
        id: ID,
      });
    });

    it.each([
      ['belongs to someone else', null],
      ['was deleted', entry({ deletedAt: STORED_AT })],
      ['is automatic', entry({ source: EntrySource.TRIP })],
      ['has another amount', entry({ amount: new Prisma.Decimal(11) })],
      ['has another nature', entry({ nature: EntryNature.EXPENSE })],
      ['has another description', entry({ description: 'Other' })],
      ['has another category', entry({ categoryId: 'cat-2' })],
      ['has another date', entry({ accrualDate: STORED_AT })],
    ])('is a conflict when the stored entry %s', async (_case, row) => {
      winner(row);

      await expect(service.create(USER, payload)).rejects.toMatchObject({
        code: 'FINANCIAL_ENTRY_ID_CONFLICT',
      });
    });

    it('lets any other failure through', async () => {
      repository.create.mockRejectedValue(new Error('connection lost'));

      await expect(service.create(USER, payload)).rejects.toThrow(
        'connection lost',
      );
    });
  });

  describe('recordPurchaseInvoice', () => {
    const invoice = {
      userId: USER,
      purchaseInvoiceId: 'invoice-1',
      amount: new Prisma.Decimal(50),
      issueDate: STORED_AT,
      number: null,
    };

    it('refuses when the supplies category was not seeded', async () => {
      await expect(
        service.recordPurchaseInvoice(invoice),
      ).rejects.toMatchObject({ code: 'FINANCIAL_CATEGORY_NOT_SEEDED' });
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('describes an invoice without a number generically', async () => {
      categories.findDefault.mockResolvedValue({
        id: 'supplies',
        defaultScope: EntryScope.PROFESSIONAL,
      });

      await service.recordPurchaseInvoice(invoice);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Purchase invoice',
          nature: EntryNature.EXPENSE,
          purchaseInvoiceId: 'invoice-1',
        }),
        undefined,
      );
    });
  });

  describe('sync', () => {
    const sync = async (operation: Partial<SyncFinancialEntryDto>) => {
      const [result] = await service.sync(USER, [
        { id: ID, occurredAt: AFTER, ...operation } as SyncFinancialEntryDto,
      ]);
      return result;
    };
    const create = { ...payload, operation: 'create' as const };

    describe('create', () => {
      it('conflicts with an entry that was deleted', async () => {
        repository.findForUser.mockResolvedValue(
          entry({ deletedAt: STORED_AT }),
        );

        await expect(sync(create)).resolves.toEqual({
          id: ID,
          result: 'conflict',
          code: 'FINANCIAL_ENTRY_SYNC_CONFLICT',
        });
      });

      it('conflicts with an id that belongs to someone else', async () => {
        repository.idIsTaken.mockResolvedValue(true);

        await expect(sync(create)).resolves.toMatchObject({
          result: 'conflict',
          code: 'FINANCIAL_ENTRY_ID_CONFLICT',
        });
        expect(repository.create).not.toHaveBeenCalled();
      });

      it.each([
        ['the same payload', create],
        ['a payload with only the id', { operation: 'create' as const }],
      ])('ignores a replay with %s', async (_case, operation) => {
        repository.findForUser.mockResolvedValue(entry());

        await expect(sync(operation)).resolves.toEqual({
          id: ID,
          result: 'ignored',
        });
      });

      it('conflicts with a stored entry that differs', async () => {
        repository.findForUser.mockResolvedValue(entry());

        await expect(sync({ ...create, amount: 99 })).resolves.toMatchObject({
          code: 'FINANCIAL_ENTRY_ID_CONFLICT',
        });
        await expect(
          sync({ ...create, scope: EntryScope.PERSONAL }),
        ).resolves.toMatchObject({ code: 'FINANCIAL_ENTRY_ID_CONFLICT' });
      });

      it.each(['nature', 'description', 'amount', 'accrualDate', 'categoryId'])(
        'needs the %s of a new entry',
        async field => {
          await expect(
            sync({ ...create, [field]: undefined }),
          ).resolves.toMatchObject({
            result: 'conflict',
            code: 'VALIDATION_ERROR',
          });
          expect(repository.create).not.toHaveBeenCalled();
        },
      );

      it('reports a rule broken by the entry and goes on with the rest', async () => {
        categories.findForUser.mockResolvedValueOnce(null);

        const results = await service.sync(USER, [
          { ...create, occurredAt: AFTER },
          { ...create, id: 'entry-2', occurredAt: AFTER },
        ]);

        expect(results.map(result => result.result)).toEqual([
          'conflict',
          'applied',
        ]);
      });

      it('stops on a failure that is not a broken rule', async () => {
        repository.create.mockRejectedValue(new Error('connection lost'));

        await expect(sync(create)).rejects.toThrow('connection lost');
      });
    });

    it.each(['update', 'delete'] as const)(
      '%s conflicts when the entry is missing or deleted',
      async operation => {
        const conflict = {
          result: 'conflict',
          code: 'FINANCIAL_ENTRY_SYNC_CONFLICT',
        };
        await expect(sync({ operation })).resolves.toMatchObject(conflict);

        repository.findForUser.mockResolvedValue(
          entry({ deletedAt: STORED_AT }),
        );
        await expect(sync({ operation })).resolves.toMatchObject(conflict);
        expect(repository.update).not.toHaveBeenCalled();
      },
    );

    it('applies a delete newer than the server copy', async () => {
      repository.findForUser.mockResolvedValue(entry());

      await expect(sync({ operation: 'delete' })).resolves.toEqual({
        id: ID,
        result: 'applied',
      });
      expect(repository.update).toHaveBeenCalledWith(USER, ID, {
        deletedAt: expect.any(Date) as Date,
      });
    });

    it('applies an update newer than the server copy', async () => {
      repository.findForUser.mockResolvedValue(entry());

      await expect(
        sync({ operation: 'update', amount: 20, notes: 'Late' }),
      ).resolves.toMatchObject({ result: 'applied' });
      expect(repository.update).toHaveBeenCalledWith(USER, ID, {
        amount: new Prisma.Decimal(20),
        notes: 'Late',
      });
    });

    it('does not conflict with what the same batch just wrote', async () => {
      const at = '2026-03-10T12:00:00.000Z';
      repository.findForUser
        .mockResolvedValueOnce(null) // the create
        .mockResolvedValueOnce(null) // inside `create`
        .mockResolvedValueOnce(entry({ updatedAt: new Date() }));

      const results = await service.sync(USER, [
        { ...create, occurredAt: at },
        { id: ID, operation: 'update', description: 'New', occurredAt: at },
      ]);

      expect(results.map(result => result.result)).toEqual([
        'applied',
        'applied',
      ]);
    });
  });

  it('finds one entry, or reports it as not found', async () => {
    await expect(service.findOne(USER, ID)).resolves.toMatchObject({ id: ID });

    repository.findOwned.mockResolvedValue(null);
    await expect(service.findOne(USER, ID)).rejects.toMatchObject({
      code: 'FINANCIAL_ENTRY_NOT_FOUND',
    });
  });

  describe('update', () => {
    it('refuses to change the nature of an automatic entry', async () => {
      repository.findOwned.mockResolvedValue(
        entry({ source: EntrySource.TRIP, tripId: 'trip-1' }),
      );

      await expect(
        service.update(USER, ID, { nature: EntryNature.EXPENSE }),
      ).rejects.toMatchObject({ code: 'FINANCIAL_ENTRY_CONTROLLED_BY_ORIGIN' });
    });

    it('checks the new category against the nature', async () => {
      await service.update(USER, ID, { categoryId: 'cat-2' });
      expect(categories.findForUser).toHaveBeenCalledTimes(1);

      categories.findForUser.mockResolvedValue({
        id: 'cat-2',
        nature: EntryNature.EXPENSE,
      });
      await expect(
        service.update(USER, ID, { categoryId: 'cat-2' }),
      ).rejects.toMatchObject({ kind: expect.any(String) as string });
    });

    it('writes only what was sent', async () => {
      await service.update(USER, ID, {
        nature: EntryNature.INCOME,
        accrualDate: AFTER,
        scope: EntryScope.PERSONAL,
      });

      expect(repository.update).toHaveBeenCalledWith(USER, ID, {
        nature: EntryNature.INCOME,
        accrualDate: new Date(AFTER),
        scope: EntryScope.PERSONAL,
      });
    });
  });

  it('deletes a manual entry, never an automatic one', async () => {
    await service.remove(USER, ID);
    expect(repository.update).toHaveBeenCalledTimes(1);

    repository.findOwned.mockResolvedValue(
      entry({ source: EntrySource.TRIP, tripId: 'trip-1' }),
    );
    await expect(service.remove(USER, ID)).rejects.toMatchObject({
      code: 'FINANCIAL_ENTRY_DELETE_VIA_ORIGIN',
      details: { type: EntrySource.TRIP, id: 'trip-1' },
    });
    expect(repository.update).toHaveBeenCalledTimes(1);
  });
});
