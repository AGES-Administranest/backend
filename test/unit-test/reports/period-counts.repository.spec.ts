import { AppointmentsRepository } from '../../../src/modules/appointments/appointments.repository';
import { EquipmentRepository } from '../../../src/modules/equipment/equipment.repository';
import { FinancialEntryRepository } from '../../../src/modules/financial/financial-entry.repository';
import { ServiceInvoicesRepository } from '../../../src/modules/service-invoices/service-invoices.repository';
import { StockEntryRepository } from '../../../src/modules/stock-entry/stock-entry.repository';
import { StockMovementsRepository } from '../../../src/modules/stock-movements/stock-movements.repository';
import { TripsRepository } from '../../../src/modules/trips/trips.repository';

/**
 * ADR-11 for the counts the reports use: each one filters by the user and
 * leaves deleted records out, over the half-open period `[from, to)`: local
 * midnight for the columns that hold an instant, UTC midnight for the date
 * columns and for the financial entry, which the statement also reads in UTC.
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
const inDays = { gte: period.days.from, lt: period.days.to };
const inInstants = { gte: period.instants.from, lt: period.instants.to };

interface Case {
  name: string;
  model: string;
  create: (prisma: unknown) => (userId: string) => Promise<number>;
  where: Record<string, unknown>;
}

const cases: Case[] = [
  {
    name: 'appointments',
    model: 'appointment',
    create: prisma => {
      const repository = new AppointmentsRepository(prisma as never);
      return userId => repository.countInPeriod(userId, period);
    },
    where: { deletedAt: null, startsAt: inInstants },
  },
  {
    name: 'financial entries',
    model: 'financialEntry',
    create: prisma => {
      const repository = new FinancialEntryRepository(prisma as never);
      return userId => repository.countInPeriod(userId, period);
    },
    where: { deletedAt: null, accrualDate: inDays },
  },
  {
    name: 'service invoices',
    model: 'serviceInvoice',
    create: prisma => {
      const repository = new ServiceInvoicesRepository(prisma as never);
      return userId => repository.countConfirmedInPeriod(userId, period);
    },
    where: { deletedAt: null, status: 'CONFIRMED', issueDate: inDays },
  },
  {
    name: 'purchase invoices',
    model: 'purchaseInvoice',
    create: prisma => {
      const repository = new StockEntryRepository(prisma as never);
      return userId => repository.countConfirmedInPeriod(userId, period);
    },
    where: { deletedAt: null, status: 'CONFIRMED', issueDate: inDays },
  },
  {
    name: 'stock movements',
    model: 'stockMovement',
    create: prisma => {
      const repository = new StockMovementsRepository(prisma as never);
      return userId => repository.countInPeriod(userId, period);
    },
    where: { deletedAt: null, occurredAt: inInstants },
  },
  {
    name: 'trips',
    model: 'trip',
    create: prisma => {
      const repository = new TripsRepository(prisma as never);
      return userId => repository.countInPeriod(userId, period);
    },
    where: { deletedAt: null, occurredOn: inDays },
  },
  {
    name: 'equipment',
    model: 'equipment',
    create: prisma => {
      const repository = new EquipmentRepository(prisma as never);
      return userId => repository.countAcquiredInPeriod(userId, period);
    },
    where: { deletedAt: null, acquisitionDate: inDays },
  },
];

describe.each(cases)('period count: $name', ({ model, create, where }) => {
  it('counts only the user records, without the deleted ones, in the period', async () => {
    const count = jest.fn().mockResolvedValue(3);
    const prisma = { [model]: { count } };

    await expect(create(prisma)('user-1')).resolves.toBe(3);

    expect(count).toHaveBeenCalledTimes(1);
    expect(count).toHaveBeenCalledWith({
      where: { userId: 'user-1', ...where },
    });
  });
});
