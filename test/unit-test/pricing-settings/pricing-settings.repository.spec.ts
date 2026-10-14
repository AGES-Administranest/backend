import { PricingSettingsRepository } from '../../../src/modules/pricing-settings/pricing-settings.repository';

describe('PricingSettingsRepository', () => {
  let prisma: {
    pricingSettings: { findUnique: jest.Mock; upsert: jest.Mock };
  };
  let repository: PricingSettingsRepository;

  beforeEach(() => {
    prisma = {
      pricingSettings: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    repository = new PricingSettingsRepository(prisma as never);
  });

  it('reads the row keyed by the owner', async () => {
    await repository.findByUserId('user-1');

    expect(prisma.pricingSettings.findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
  });

  it('creates or overwrites only the three goals, leaving the transport cost alone', async () => {
    const goals = {
      monthlyIncomeGoal: 8000,
      weeklyHours: 40,
      safetyMarginPct: 10,
    };

    await repository.saveGoals('user-1', goals);

    expect(prisma.pricingSettings.upsert).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      create: { userId: 'user-1', ...goals },
      update: goals,
    });
  });

  it('writes nothing but the goals even if the object carries more', async () => {
    const goals = {
      monthlyIncomeGoal: 8000,
      weeklyHours: 40,
      safetyMarginPct: 10,
      transportCostMonthly: 0,
    };

    await repository.saveGoals('user-1', goals);

    const [{ create, update }] = prisma.pricingSettings.upsert.mock
      .calls[0] as [{ create: object; update: object }];
    expect(create).not.toHaveProperty('transportCostMonthly');
    expect(update).not.toHaveProperty('transportCostMonthly');
  });
});
