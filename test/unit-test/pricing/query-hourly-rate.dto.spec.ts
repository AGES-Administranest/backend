import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { QueryHourlyRateDto } from '../../../src/modules/pricing/dto/query-hourly-rate.dto';

const errorsFor = (plain: Record<string, unknown>) =>
  validate(plainToInstance(QueryHourlyRateDto, plain));

describe('QueryHourlyRateDto', () => {
  it('accepts an empty query and a valid month and year', async () => {
    expect(await errorsFor({})).toHaveLength(0);
    expect(await errorsFor({ month: '10', year: '2026' })).toHaveLength(0);
    expect(await errorsFor({ month: '1' })).toHaveLength(0);
  });

  it.each([
    { month: '0' },
    { month: '13' },
    { month: '1.5' },
    { month: 'x' },
    { month: '2026-10' },
    { year: '1999' },
    { year: '2101' },
  ])('rejects %p', async plain => {
    expect(await errorsFor(plain)).not.toHaveLength(0);
  });
});
