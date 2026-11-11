import { ReportsService } from '../../../src/modules/reports/reports.service';
import { DomainError } from '../../../src/shared/errors/domain-error';

describe('ReportsService.getAvailability', () => {
  const userId = 'user-1';

  let appointments: { countInPeriod: jest.Mock };
  let financialEntries: { countInPeriod: jest.Mock };
  let serviceInvoices: { countConfirmedInPeriod: jest.Mock };
  let purchaseInvoices: { countConfirmedInPeriod: jest.Mock };
  let stockMovements: { countInPeriod: jest.Mock };
  let trips: { countInPeriod: jest.Mock };
  let equipment: { countAcquiredInPeriod: jest.Mock };
  let service: ReportsService;

  beforeEach(() => {
    appointments = { countInPeriod: jest.fn().mockResolvedValue(1) };
    financialEntries = { countInPeriod: jest.fn().mockResolvedValue(2) };
    serviceInvoices = {
      countConfirmedInPeriod: jest.fn().mockResolvedValue(3),
    };
    purchaseInvoices = {
      countConfirmedInPeriod: jest.fn().mockResolvedValue(4),
    };
    stockMovements = { countInPeriod: jest.fn().mockResolvedValue(5) };
    trips = { countInPeriod: jest.fn().mockResolvedValue(6) };
    equipment = { countAcquiredInPeriod: jest.fn().mockResolvedValue(7) };

    service = new ReportsService(
      appointments as never,
      financialEntries as never,
      serviceInvoices as never,
      purchaseInvoices as never,
      stockMovements as never,
      trips as never,
      equipment as never,
    );
  });

  it('returns the count of each section and their total', async () => {
    await expect(
      service.getAvailability(userId, { from: '2026-10-01', to: '2026-10-31' }),
    ).resolves.toEqual({
      appointments: 1,
      financialEntries: 2,
      serviceInvoices: 3,
      purchaseInvoices: 4,
      stockMovements: 5,
      trips: 6,
      equipments: 7,
      total: 28,
    });
  });

  it('reports zero everywhere when the period has no records', async () => {
    for (const source of [
      appointments.countInPeriod,
      financialEntries.countInPeriod,
      serviceInvoices.countConfirmedInPeriod,
      purchaseInvoices.countConfirmedInPeriod,
      stockMovements.countInPeriod,
      trips.countInPeriod,
      equipment.countAcquiredInPeriod,
    ]) {
      source.mockResolvedValue(0);
    }

    const result = await service.getAvailability(userId, {
      from: '2026-10-01',
      to: '2026-10-31',
    });

    expect(result.total).toBe(0);
  });

  it('gives each count the limits of its column kind', async () => {
    await service.getAvailability(userId, {
      from: '2026-10-01',
      to: '2026-10-31',
    });

    // `@db.Date` columns and the financial entry (written at UTC midnight).
    const days = {
      from: new Date('2026-10-01T00:00:00.000Z'),
      to: new Date('2026-11-01T00:00:00.000Z'),
    };
    // Instants: October in Brasília runs from 03:00Z to 03:00Z.
    const instants = {
      from: new Date('2026-10-01T03:00:00.000Z'),
      to: new Date('2026-11-01T03:00:00.000Z'),
    };
    const period = { days, instants };

    for (const source of [
      appointments.countInPeriod,
      financialEntries.countInPeriod,
      serviceInvoices.countConfirmedInPeriod,
      purchaseInvoices.countConfirmedInPeriod,
      stockMovements.countInPeriod,
      trips.countInPeriod,
      equipment.countAcquiredInPeriod,
    ]) {
      expect(source).toHaveBeenCalledWith(userId, period);
    }
  });

  it('accepts a single-day period', async () => {
    await service.getAvailability(userId, {
      from: '2026-10-15',
      to: '2026-10-15',
    });

    expect(trips.countInPeriod).toHaveBeenCalledWith(userId, {
      days: {
        from: new Date('2026-10-15T00:00:00.000Z'),
        to: new Date('2026-10-16T00:00:00.000Z'),
      },
      instants: {
        from: new Date('2026-10-15T03:00:00.000Z'),
        to: new Date('2026-10-16T03:00:00.000Z'),
      },
    });
  });

  it('rejects `from` after `to` with REPORT_PERIOD_INVALID and counts nothing', async () => {
    const error = await service
      .getAvailability(userId, { from: '2026-10-31', to: '2026-10-01' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({
      kind: 'INVALID_INPUT',
      code: 'REPORT_PERIOD_INVALID',
    });
    expect(appointments.countInPeriod).not.toHaveBeenCalled();
    expect(trips.countInPeriod).not.toHaveBeenCalled();
  });
});
