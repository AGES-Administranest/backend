import { Prisma } from '@prisma/client';

import {
  HourlyRateSnapshotData,
  HourlyRateSnapshotRepository,
} from '../../../src/modules/pricing/hourly-rate-snapshot.repository';

const dec = (value: string) => new Prisma.Decimal(value);

const snapshot: HourlyRateSnapshotData = {
  userId: 'user-1',
  year: 2026,
  month: 10,
  hourlyRate: dec('98.07'),
  fixedCosts: dec('1399.08'),
  variableCosts: dec('1225'),
  ownerDraw: dec('8000'),
  safetyMargin: dec('2124.82'),
  monthlyIncomeGoal: dec('8000'),
  weeklyHours: dec('30'),
  safetyMarginPct: dec('20'),
  calculatedAt: new Date('2026-10-19T20:42:00.000Z'),
};

describe('HourlyRateSnapshotRepository', () => {
  let prisma: {
    hourlyRateSnapshot: {
      upsert: jest.Mock;
      createMany: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
  };
  let repository: HourlyRateSnapshotRepository;

  beforeEach(() => {
    prisma = {
      hourlyRateSnapshot: {
        upsert: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    repository = new HourlyRateSnapshotRepository(prisma as never);
  });

  const where = {
    userId_year_month: { userId: 'user-1', year: 2026, month: 10 },
  };

  it('upserts by owner and month, replacing every value', async () => {
    await repository.save(snapshot, { replace: true });

    const values = {
      hourlyRate: snapshot.hourlyRate,
      fixedCosts: snapshot.fixedCosts,
      variableCosts: snapshot.variableCosts,
      ownerDraw: snapshot.ownerDraw,
      safetyMargin: snapshot.safetyMargin,
      monthlyIncomeGoal: snapshot.monthlyIncomeGoal,
      weeklyHours: snapshot.weeklyHours,
      safetyMarginPct: snapshot.safetyMarginPct,
      calculatedAt: snapshot.calculatedAt,
    };
    expect(prisma.hourlyRateSnapshot.upsert).toHaveBeenCalledWith({
      where,
      create: snapshot,
      update: values,
    });
  });

  it('inserts skipping a duplicate, without an upsert, when an existing month must be kept', async () => {
    await repository.save(snapshot, { replace: false });

    expect(prisma.hourlyRateSnapshot.createMany).toHaveBeenCalledWith({
      data: [snapshot],
      skipDuplicates: true,
    });
    expect(prisma.hourlyRateSnapshot.upsert).not.toHaveBeenCalled();
  });

  it('does not insert when the month must be replaced', async () => {
    await repository.save(snapshot, { replace: true });

    expect(prisma.hourlyRateSnapshot.createMany).not.toHaveBeenCalled();
  });

  it('never lets the update move the row to another owner or month', async () => {
    await repository.save(snapshot, { replace: true });

    const [{ update }] = prisma.hourlyRateSnapshot.upsert.mock.calls[0] as [
      { update: object },
    ];
    expect(update).not.toHaveProperty('userId');
    expect(update).not.toHaveProperty('year');
    expect(update).not.toHaveProperty('month');
  });

  it('reads one month keyed by the owner', async () => {
    await repository.findMonth('user-1', { year: 2026, month: 10 });

    expect(prisma.hourlyRateSnapshot.findUnique).toHaveBeenCalledWith({
      where,
    });
  });

  it('lists the owner months between both bounds, latest first', async () => {
    await repository.findInRange(
      'user-1',
      { year: 2025, month: 11 },
      { year: 2026, month: 3 },
    );

    expect(prisma.hourlyRateSnapshot.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        AND: [
          {
            OR: [{ year: { gt: 2025 } }, { year: 2025, month: { gte: 11 } }],
          },
          {
            OR: [{ year: { lt: 2026 } }, { year: 2026, month: { lte: 3 } }],
          },
        ],
      },
      select: { year: true, month: true, hourlyRate: true, calculatedAt: true },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  });

  it('still filters by owner without bounds', async () => {
    await repository.findInRange('user-1');

    expect(prisma.hourlyRateSnapshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', AND: [] } }),
    );
  });
});
