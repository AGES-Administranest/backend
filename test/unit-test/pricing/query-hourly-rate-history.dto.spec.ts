import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { HourlyRateMonthParamsDto } from '../../../src/modules/pricing/dto/hourly-rate-month-params.dto';
import { QueryHourlyRateHistoryDto } from '../../../src/modules/pricing/dto/query-hourly-rate-history.dto';

describe('QueryHourlyRateHistoryDto', () => {
  const errorsFor = (plain: Record<string, unknown>) =>
    validate(plainToInstance(QueryHourlyRateHistoryDto, plain));

  it('accepts no bounds, one bound or both', async () => {
    expect(await errorsFor({})).toHaveLength(0);
    expect(await errorsFor({ from: '2026-01' })).toHaveLength(0);
    expect(await errorsFor({ to: '2026-10' })).toHaveLength(0);
    expect(await errorsFor({ from: '2000-01', to: '2100-12' })).toHaveLength(0);
  });

  it.each([
    { from: '2026-1' },
    { from: '2026-13' },
    { from: '1999-12' },
    { to: '2101-01' },
    { to: '2026-10-01' },
    { to: '10/2026' },
    { to: '' },
  ])('rejects %p', async plain => {
    expect(await errorsFor(plain)).not.toHaveLength(0);
  });
});

describe('HourlyRateMonthParamsDto', () => {
  const errorsFor = (plain: Record<string, unknown>) =>
    validate(plainToInstance(HourlyRateMonthParamsDto, plain));

  it('accepts a year and a month from the path', async () => {
    expect(await errorsFor({ year: '2026', month: '10' })).toHaveLength(0);
    expect(await errorsFor({ year: '2000', month: '1' })).toHaveLength(0);
  });

  it.each([
    { year: '2026', month: '0' },
    { year: '2026', month: '13' },
    { year: '2026', month: '1.5' },
    { year: '2026', month: 'x' },
    { year: '1999', month: '10' },
    { year: '2101', month: '10' },
  ])('rejects %p', async plain => {
    expect(await errorsFor(plain)).not.toHaveLength(0);
  });
});
