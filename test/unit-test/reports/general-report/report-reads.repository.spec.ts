import { AppointmentStatus, EntryNature, Prisma } from '@prisma/client';

import { AppointmentsRepository } from '../../../../src/modules/appointments/appointments.repository';
import { ClientRepository } from '../../../../src/modules/client/client.repository';
import { FinancialEntryRepository } from '../../../../src/modules/financial/financial-entry.repository';
import { StockEntryRepository } from '../../../../src/modules/stock-entry/stock-entry.repository';
import { StockMovementsService } from '../../../../src/modules/stock-movements/stock-movements.service';
import { SupplierRepository } from '../../../../src/modules/supplier/supplier.repository';
import { TripsRepository } from '../../../../src/modules/trips/trips.repository';

/**
 * The reads the general report (US29) added to the modules that own the data.
 * The grouped ones must filter exactly like the per-client ones they extend,
 * so the report and the client's card (US17) cannot disagree.
 */
const period = {
  days: {
    from: new Date('2026-10-01T00:00:00.000Z'),
    to: new Date('2026-11-01T00:00:00.000Z'),
  },
  instants: {
    from: new Date('2026-10-01T03:00:00.000Z'),
    to: new Date('2026-11-01T03:00:00.000Z'),
  },
};
const d = (value: string | number) => new Prisma.Decimal(value);

/** The first argument of the first call of a Prisma method mock. */
interface QueryArgs {
  by?: string[];
  where: Record<string, unknown>;
  orderBy?: unknown;
  select?: Record<string, unknown>;
}
const argsOf = (mock: jest.Mock): QueryArgs =>
  (mock.mock.calls as [QueryArgs][])[0][0];

describe('appointments read by the report', () => {
  const appointmentPeriod = {
    from: period.instants.from,
    before: period.instants.to,
  };

  it('groups by client with the filter of the client summary', async () => {
    const groupBy = jest.fn().mockResolvedValue([
      { clientId: 'c-1', _count: { _all: 2 }, _sum: { amount: d('900') } },
      { clientId: null, _count: { _all: 1 }, _sum: { amount: null } },
    ]);
    const aggregate = jest
      .fn()
      .mockResolvedValue({ _count: { _all: 0 }, _sum: { amount: null } });
    const repository = new AppointmentsRepository({
      appointment: { groupBy, aggregate },
    } as never);

    const rows = await repository.sumCompletedGroupedByClient(
      'user-1',
      appointmentPeriod,
    );
    await repository.sumCompletedByClient('user-1', 'c-1', appointmentPeriod);

    const grouped = argsOf(groupBy);
    const perClient = argsOf(aggregate);
    expect(grouped.by).toEqual(['clientId']);
    expect(grouped.where).toEqual({
      userId: 'user-1',
      status: AppointmentStatus.COMPLETED,
      deletedAt: null,
      startsAt: { gte: period.instants.from, lt: period.instants.to },
    });
    expect(perClient.where).toEqual({ ...grouped.where, clientId: 'c-1' });
    expect(
      rows.map(row => [row.clientId, row.count, row.amount.toFixed(2)]),
    ).toEqual([
      ['c-1', 2, '900.00'],
      [null, 1, '0.00'],
    ]);
  });

  it('lists the completed appointments oldest first, with the client', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repository = new AppointmentsRepository({
      appointment: { findMany },
    } as never);

    await repository.findCompletedInPeriod('user-1', appointmentPeriod);

    const args = argsOf(findMany);
    expect(args.where).toMatchObject({
      userId: 'user-1',
      status: AppointmentStatus.COMPLETED,
      deletedAt: null,
    });
    expect(args.orderBy).toEqual([{ startsAt: 'asc' }, { id: 'asc' }]);
    expect(args.select).toMatchObject({
      asa: true,
      weightKg: true,
      client: {
        select: { name: true, addressLine: true, city: true, state: true },
      },
    });
  });
});

describe('trips read by the report', () => {
  const tripPeriod = {
    from: new Date('2026-10-01T00:00:00.000Z'),
    to: new Date('2026-10-31T00:00:00.000Z'),
  };
  const tripWhere = {
    userId: 'user-1',
    deletedAt: null,
    occurredOn: { gte: tripPeriod.from, lte: tripPeriod.to },
  };

  it('groups by client with the filter of the client summary', async () => {
    const groupBy = jest
      .fn()
      .mockResolvedValue([
        { clientId: null, _count: { _all: 2 }, _sum: { cost: d('30') } },
      ]);
    const aggregate = jest
      .fn()
      .mockResolvedValue({ _count: { _all: 0 }, _sum: { cost: null } });
    const repository = new TripsRepository({
      trip: { groupBy, aggregate },
    } as never);

    const rows = await repository.sumGroupedByClient('user-1', tripPeriod);
    await repository.sumByClient('user-1', 'c-1', tripPeriod);

    expect(argsOf(groupBy).where).toEqual(tripWhere);
    expect(argsOf(aggregate).where).toEqual({
      ...tripWhere,
      clientId: 'c-1',
    });
    expect(rows[0]).toEqual({ clientId: null, count: 2, cost: d('30') });
  });

  it('adds up km and cost of the period, a missing sum being zero', async () => {
    const aggregate = jest.fn().mockResolvedValue({
      _count: { _all: 0 },
      _sum: { distanceKm: null, cost: null },
    });
    const repository = new TripsRepository({ trip: { aggregate } } as never);

    const totals = await repository.sumInPeriod('user-1', tripPeriod);

    expect(aggregate).toHaveBeenCalledWith({
      where: tripWhere,
      _count: { _all: true },
      _sum: { distanceKm: true, cost: true },
    });
    expect([
      totals.count,
      totals.distanceKm.toFixed(2),
      totals.cost.toFixed(2),
    ]).toEqual([0, '0.00', '0.00']);
  });
});

describe('purchases read by the report', () => {
  const confirmedWhere = {
    userId: 'user-1',
    deletedAt: null,
    status: 'CONFIRMED',
    issueDate: { gte: period.days.from, lt: period.days.to },
  };

  it('adds up what the availability check counts', async () => {
    const count = jest.fn().mockResolvedValue(0);
    const aggregate = jest
      .fn()
      .mockResolvedValue({ _count: { _all: 2 }, _sum: { totalAmount: null } });
    const repository = new StockEntryRepository({
      purchaseInvoice: { count, aggregate },
    } as never);

    await repository.countConfirmedInPeriod('user-1', period);
    const totals = await repository.sumConfirmedInPeriod('user-1', period);

    expect(count).toHaveBeenCalledWith({ where: confirmedWhere });
    expect(argsOf(aggregate).where).toEqual(confirmedWhere);
    expect(totals).toEqual({ count: 2, total: d(0) });
  });

  it('groups the same purchases by supplier', async () => {
    const groupBy = jest.fn().mockResolvedValue([
      {
        supplierId: 's-1',
        _count: { _all: 1 },
        _sum: { totalAmount: d('300') },
      },
    ]);
    const repository = new StockEntryRepository({
      purchaseInvoice: { groupBy },
    } as never);

    const rows = await repository.sumConfirmedBySupplierInPeriod(
      'user-1',
      period,
    );

    expect(argsOf(groupBy)).toMatchObject({
      by: ['supplierId'],
      where: confirmedWhere,
    });
    expect(rows).toEqual([{ supplierId: 's-1', count: 1, total: d('300') }]);
  });
});

describe('names read by the report', () => {
  it.each([
    ['client', (prisma: unknown) => new ClientRepository(prisma as never)],
    ['supplier', (prisma: unknown) => new SupplierRepository(prisma as never)],
  ])(
    'reads %s names of the owner, deleted ones included',
    async (model, create) => {
      const findMany = jest.fn().mockResolvedValue([]);
      await create({ [model]: { findMany } }).findNames('user-1', ['x-1']);

      expect(findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', id: { in: ['x-1'] } },
        select: { id: true, name: true },
      });
    },
  );
});

describe('income read by the report', () => {
  it('groups the income of the statement by source', async () => {
    const groupBy = jest.fn().mockResolvedValue([]);
    const repository = new FinancialEntryRepository({
      financialEntry: { groupBy },
    } as never);

    await repository.sumIncomeBySource('user-1', period.days);

    expect(groupBy).toHaveBeenCalledWith({
      by: ['source'],
      where: {
        userId: 'user-1',
        deletedAt: null,
        accrualDate: { gte: period.days.from, lt: period.days.to },
        nature: EntryNature.INCOME,
      },
      _sum: { amount: true },
    });
  });
});

describe('stock consumption read by the report', () => {
  it('reads only the supplies of completed, live appointments in the period', async () => {
    const findForSummary = jest.fn().mockResolvedValue([]);
    const service = new StockMovementsService({ findForSummary } as never);

    await service.consumptionInPeriod('user-1', period);

    expect(findForSummary).toHaveBeenCalledWith({
      userId: 'user-1',
      deletedAt: null,
      appointment: {
        is: { deletedAt: null, status: AppointmentStatus.COMPLETED },
      },
      occurredAt: { gte: period.instants.from, lt: period.instants.to },
    });
  });
});
