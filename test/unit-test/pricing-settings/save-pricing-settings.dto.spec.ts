import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SavePricingSettingsDto } from '../../../src/modules/pricing-settings/dto/save-pricing-settings.dto';

const VALID = { monthlyIncomeGoal: 8000, weeklyHours: 40, safetyMarginPct: 10 };

// Same options as the global ValidationPipe in src/main.ts.
const failingFields = async (body: Record<string, unknown>) => {
  const errors = await validate(plainToInstance(SavePricingSettingsDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map(error => error.property);
};

describe('SavePricingSettingsDto', () => {
  it('accepts the three goals', async () => {
    expect(await failingFields(VALID)).toEqual([]);
  });

  it('accepts values with 2 decimal places', async () => {
    expect(
      await failingFields({
        monthlyIncomeGoal: 8000.55,
        weeklyHours: 37.5,
        safetyMarginPct: 12.25,
      }),
    ).toEqual([]);
  });

  it.each(Object.keys(VALID))('requires %s', async field => {
    const body: Record<string, unknown> = { ...VALID };
    delete body[field];

    expect(await failingFields(body)).toEqual([field]);
  });

  it.each(Object.keys(VALID))('refuses %s = null', async field => {
    expect(await failingFields({ ...VALID, [field]: null })).toEqual([field]);
  });

  it.each(Object.keys(VALID))(
    'refuses %s sent as a string, even a numeric one',
    async field => {
      expect(await failingFields({ ...VALID, [field]: '10' })).toEqual([field]);
    },
  );

  it.each(Object.keys(VALID))(
    'refuses %s with more than 2 decimal places',
    async field => {
      expect(await failingFields({ ...VALID, [field]: 10.555 })).toEqual([
        field,
      ]);
    },
  );

  describe('monthlyIncomeGoal', () => {
    it.each([0, -1])('refuses %p', async value => {
      expect(
        await failingFields({ ...VALID, monthlyIncomeGoal: value }),
      ).toEqual(['monthlyIncomeGoal']);
    });

    it('refuses a value past the DECIMAL(14, 2) column', async () => {
      expect(
        await failingFields({ ...VALID, monthlyIncomeGoal: 1_000_000_000_000 }),
      ).toEqual(['monthlyIncomeGoal']);
    });
  });

  describe('weeklyHours', () => {
    // Acceptance criterion: zero is refused, it would divide the hour value by zero.
    it.each([0, -5])('refuses %p', async value => {
      expect(await failingFields({ ...VALID, weeklyHours: value })).toEqual([
        'weeklyHours',
      ]);
    });

    it('accepts the whole week, 168 hours', async () => {
      expect(await failingFields({ ...VALID, weeklyHours: 168 })).toEqual([]);
    });

    it('refuses more hours than a week has', async () => {
      expect(await failingFields({ ...VALID, weeklyHours: 168.01 })).toEqual([
        'weeklyHours',
      ]);
    });
  });

  describe('safetyMarginPct', () => {
    it.each([0, 100])('accepts the bound %p', async value => {
      expect(await failingFields({ ...VALID, safetyMarginPct: value })).toEqual(
        [],
      );
    });

    // Acceptance criterion: outside 0–100 is a validation error.
    it.each([-0.01, 100.01, 150])('refuses %p', async value => {
      expect(await failingFields({ ...VALID, safetyMarginPct: value })).toEqual(
        ['safetyMarginPct'],
      );
    });
  });

  it.each(['transportCostMonthly', 'userId'])(
    'refuses %s, which this route does not write',
    async field => {
      expect(await failingFields({ ...VALID, [field]: 100 })).toEqual([field]);
    },
  );
});
