import { PricingSettings, Prisma } from '@prisma/client';

import { PricingSettingsService } from '../../../src/modules/pricing-settings/pricing-settings.service';
import { DomainError } from '../../../src/shared/errors/domain-error';

const UPDATED_AT = new Date('2026-10-12T12:00:00Z');

const row = (overrides: Partial<PricingSettings> = {}): PricingSettings => ({
  userId: 'user-1',
  monthlyIncomeGoal: new Prisma.Decimal('8000.50'),
  weeklyHours: new Prisma.Decimal('37.5'),
  safetyMarginPct: new Prisma.Decimal('10'),
  transportCostMonthly: new Prisma.Decimal('450'),
  updatedAt: UPDATED_AT,
  ...overrides,
});

// A row created by US18 before the user ever saved the US19 goals.
const transportOnly = row({
  monthlyIncomeGoal: null,
  weeklyHours: null,
  safetyMarginPct: null,
});

describe('PricingSettingsService', () => {
  let repository: {
    findByUserId: jest.Mock;
    saveGoals: jest.Mock;
    saveTransportCost: jest.Mock;
  };
  let service: PricingSettingsService;

  beforeEach(() => {
    repository = {
      findByUserId: jest.fn().mockResolvedValue(row()),
      saveGoals: jest.fn().mockResolvedValue(row()),
      saveTransportCost: jest.fn().mockResolvedValue(row()),
    };
    service = new PricingSettingsService(repository as never);
  });

  describe('find', () => {
    it("returns the token owner's goals as numbers", async () => {
      await expect(service.find('user-1')).resolves.toEqual({
        monthlyIncomeGoal: 8000.5,
        weeklyHours: 37.5,
        safetyMarginPct: 10,
        updatedAt: UPDATED_AT,
      });
      expect(repository.findByUserId).toHaveBeenCalledWith('user-1');
    });

    it('leaves the owner and the transport cost out of the response', async () => {
      const settings = await service.find('user-1');

      expect(settings).not.toHaveProperty('userId');
      expect(settings).not.toHaveProperty('transportCostMonthly');
    });

    it.each([
      ['there is no row', null],
      ['the row only has the transport cost', transportOnly],
      ['a goal is missing', row({ safetyMarginPct: null })],
    ])('answers PRICING_SETTINGS_NOT_FOUND when %s', async (_case, found) => {
      repository.findByUserId.mockResolvedValue(found);

      const error = await service.find('user-1').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(DomainError);
      expect(error).toMatchObject({
        kind: 'NOT_FOUND',
        code: 'PRICING_SETTINGS_NOT_FOUND',
      });
    });
  });

  describe('findConfigured', () => {
    it('returns null instead of throwing while not configured', async () => {
      repository.findByUserId.mockResolvedValue(transportOnly);

      await expect(service.findConfigured('user-1')).resolves.toBeNull();
    });

    it('returns the goals once configured', async () => {
      await expect(service.findConfigured('user-1')).resolves.toMatchObject({
        weeklyHours: 37.5,
      });
    });
  });

  describe('save', () => {
    const dto = {
      monthlyIncomeGoal: 8000.5,
      weeklyHours: 37.5,
      safetyMarginPct: 10,
    };

    it('saves the goals for the token owner and returns them', async () => {
      await expect(service.save('user-1', dto)).resolves.toEqual({
        ...dto,
        updatedAt: UPDATED_AT,
      });
      expect(repository.saveGoals).toHaveBeenCalledWith('user-1', dto);
    });

    it('fails loudly if the write came back without the goals', async () => {
      repository.saveGoals.mockResolvedValue(transportOnly);

      await expect(service.save('user-1', dto)).rejects.not.toBeInstanceOf(
        DomainError,
      );
    });
  });

  describe('findTransportCost', () => {
    it('returns the transport cost as a number with the last change', async () => {
      await expect(service.findTransportCost('user-1')).resolves.toEqual({
        transportCostMonthly: 450,
        updatedAt: UPDATED_AT,
      });
      expect(repository.findByUserId).toHaveBeenCalledWith('user-1');
    });

    it('returns a transport cost of zero instead of treating it as empty', async () => {
      repository.findByUserId.mockResolvedValue(
        row({ transportCostMonthly: new Prisma.Decimal('0') }),
      );

      await expect(service.findTransportCost('user-1')).resolves.toMatchObject({
        transportCostMonthly: 0,
      });
    });

    it('works while the goals are not configured', async () => {
      repository.findByUserId.mockResolvedValue(transportOnly);

      await expect(service.findTransportCost('user-1')).resolves.toMatchObject({
        transportCostMonthly: 450,
      });
    });

    it.each([
      ['there is no row', null],
      ['the row only has the goals', row({ transportCostMonthly: null })],
    ])('answers TRANSPORT_COST_NOT_FOUND when %s', async (_case, found) => {
      repository.findByUserId.mockResolvedValue(found);

      const error = await service
        .findTransportCost('user-1')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(DomainError);
      expect(error).toMatchObject({
        kind: 'NOT_FOUND',
        code: 'TRANSPORT_COST_NOT_FOUND',
      });
    });
  });

  describe('saveTransportCost', () => {
    const dto = { transportCostMonthly: 450 };

    it('saves the transport cost for the token owner and returns it', async () => {
      await expect(service.saveTransportCost('user-1', dto)).resolves.toEqual({
        transportCostMonthly: 450,
        updatedAt: UPDATED_AT,
      });
      expect(repository.saveTransportCost).toHaveBeenCalledWith('user-1', 450);
    });

    it('returns zero as zero', async () => {
      repository.saveTransportCost.mockResolvedValue(
        row({ transportCostMonthly: new Prisma.Decimal('0') }),
      );

      await expect(
        service.saveTransportCost('user-1', { transportCostMonthly: 0 }),
      ).resolves.toMatchObject({ transportCostMonthly: 0 });
    });

    it('fails loudly if the write came back without the value', async () => {
      repository.saveTransportCost.mockResolvedValue(
        row({ transportCostMonthly: null }),
      );

      await expect(
        service.saveTransportCost('user-1', dto),
      ).rejects.not.toBeInstanceOf(DomainError);
    });
  });
});
