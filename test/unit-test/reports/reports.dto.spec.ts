import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { QueryReportsAvailabilityDto } from '../../../src/modules/reports/dto/query-reports-availability.dto';

const failedProperties = async (query: Record<string, unknown>) => {
  const errors = await validate(
    plainToInstance(QueryReportsAvailabilityDto, query),
    { whitelist: true, forbidNonWhitelisted: true },
  );
  return errors.map(error => error.property).sort();
};

describe('QueryReportsAvailabilityDto', () => {
  it('accepts two valid dates', async () => {
    expect(
      await failedProperties({ from: '2026-10-01', to: '2026-10-31' }),
    ).toEqual([]);
  });

  it('requires both dates', async () => {
    expect(await failedProperties({})).toEqual(['from', 'to']);
    expect(await failedProperties({ from: '2026-10-01' })).toEqual(['to']);
  });

  it.each(['20261001', '2026-W40', '2026-02-30', '2026-10-01T10:00:00Z', 'x'])(
    'rejects %s as a date',
    async value => {
      expect(await failedProperties({ from: value, to: '2026-10-31' })).toEqual(
        ['from'],
      );
    },
  );

  it('rejects any other field, such as a userId', async () => {
    expect(
      await failedProperties({
        from: '2026-10-01',
        to: '2026-10-31',
        userId: 'someone-else',
      }),
    ).toEqual(['userId']);
  });
});
