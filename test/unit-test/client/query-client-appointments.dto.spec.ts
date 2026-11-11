import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  MAX_PAGE,
  QueryClientAppointmentsDto,
} from '../../../src/modules/client/dto/query-client-appointments.dto';

const invalidFields = async (query: Record<string, unknown>) => {
  const errors = await validate(
    plainToInstance(QueryClientAppointmentsDto, query),
    { whitelist: true, forbidNonWhitelisted: true },
  );
  return errors.map(error => error.property);
};

describe('QueryClientAppointmentsDto', () => {
  it('defaults to the first page of 20, with no period', () => {
    const query = plainToInstance(QueryClientAppointmentsDto, {});

    expect(query).toMatchObject({ page: 1, limit: 20 });
    expect(query.from).toBeUndefined();
    expect(query.to).toBeUndefined();
  });

  it('turns the query string numbers into numbers', () => {
    expect(
      plainToInstance(QueryClientAppointmentsDto, { page: '2', limit: '10' }),
    ).toMatchObject({ page: 2, limit: 10 });
  });

  it('accepts a period written as YYYY-MM-DD', async () => {
    expect(
      await invalidFields({ from: '2026-11-01', to: '2026-11-30' }),
    ).toEqual([]);
  });

  it.each(['20261101', '2026-02-30', '2026-11-01T00:00:00.000Z'])(
    'rejects %s as a date',
    async value => {
      expect(await invalidFields({ from: value })).toEqual(['from']);
      expect(await invalidFields({ to: value })).toEqual(['to']);
    },
  );

  it.each([
    ['page', 0],
    ['page', MAX_PAGE + 1],
    ['page', '99999999999999999999'],
    ['limit', 0],
    ['limit', 101],
    ['limit', 'abc'],
  ])('rejects %s = %s', async (field, value) => {
    expect(await invalidFields({ [field]: value })).toEqual([field]);
  });

  it('refuses a userId in the query', async () => {
    expect(await invalidFields({ userId: 'someone-else' })).toEqual(['userId']);
  });
});
