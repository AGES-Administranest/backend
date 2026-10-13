import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { QueryFixedCostsSummaryDto } from '../../../src/modules/fixed-costs/dto/query-fixed-costs-summary.dto';

const errorsFor = (plain: Record<string, unknown>) =>
  validate(plainToInstance(QueryFixedCostsSummaryDto, plain));

describe('QueryFixedCostsSummaryDto', () => {
  it('accepts an empty query and a valid month and year', async () => {
    expect(await errorsFor({})).toHaveLength(0);
    expect(await errorsFor({ month: '12', year: '2026' })).toHaveLength(0);
  });

  it.each([{ month: '0' }, { month: '13' }, { month: 'x' }, { year: '1999' }])(
    'rejects %p',
    async plain => {
      expect(await errorsFor(plain)).not.toHaveLength(0);
    },
  );
});
