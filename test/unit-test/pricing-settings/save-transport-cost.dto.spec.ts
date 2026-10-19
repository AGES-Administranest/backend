import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { SaveTransportCostDto } from '../../../src/modules/pricing-settings/dto/save-transport-cost.dto';

// Same options as the global ValidationPipe in src/main.ts.
const failingFields = async (body: Record<string, unknown>) => {
  const errors = await validate(plainToInstance(SaveTransportCostDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map(error => error.property);
};

describe('SaveTransportCostDto', () => {
  it.each([450, 450.55, 0.01, 999_999_999_999.99])(
    'accepts %p',
    async value => {
      expect(await failingFields({ transportCostMonthly: value })).toEqual([]);
    },
  );

  // Acceptance criterion: zero is valid, a professional who does not drive.
  it('accepts zero', async () => {
    expect(await failingFields({ transportCostMonthly: 0 })).toEqual([]);
  });

  it('requires transportCostMonthly', async () => {
    expect(await failingFields({})).toEqual(['transportCostMonthly']);
  });

  it.each([
    ['null', null],
    ['a string', '10'],
    ['an empty string', ''],
    ['a boolean', true],
    ['NaN', NaN],
    ['Infinity', Infinity],
  ])('refuses %s', async (_case, value) => {
    expect(await failingFields({ transportCostMonthly: value })).toEqual([
      'transportCostMonthly',
    ]);
  });

  it.each([-0.01, -1])('refuses the negative value %p', async value => {
    expect(await failingFields({ transportCostMonthly: value })).toEqual([
      'transportCostMonthly',
    ]);
  });

  it('refuses more than 2 decimal places', async () => {
    expect(await failingFields({ transportCostMonthly: 10.555 })).toEqual([
      'transportCostMonthly',
    ]);
  });

  it('refuses a value past the DECIMAL(14, 2) column', async () => {
    expect(
      await failingFields({ transportCostMonthly: 1_000_000_000_000 }),
    ).toEqual(['transportCostMonthly']);
  });

  it.each(['userId', 'monthlyIncomeGoal', 'weeklyHours', 'safetyMarginPct'])(
    'refuses %s, which this route does not write',
    async field => {
      expect(
        await failingFields({ transportCostMonthly: 450, [field]: 10 }),
      ).toEqual([field]);
    },
  );
});
