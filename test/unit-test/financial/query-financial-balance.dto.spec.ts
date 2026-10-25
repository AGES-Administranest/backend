import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { QueryFinancialBalanceDto } from '../../../src/modules/financial/dto/query-financial-balance.dto';

const errorsFor = (plain: Record<string, unknown>) =>
  validate(plainToInstance(QueryFinancialBalanceDto, plain));

describe('QueryFinancialBalanceDto', () => {
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
