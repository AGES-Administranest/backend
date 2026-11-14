import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  QueryReportHistoryDto,
  REPORT_HISTORY_MAX_PAGE,
} from '../../../src/modules/reports/dto/query-report-history.dto';

const parse = (query: Record<string, unknown>) =>
  plainToInstance(QueryReportHistoryDto, query);

const failedProperties = async (query: Record<string, unknown>) => {
  const errors = await validate(parse(query), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map(error => error.property).sort();
};

describe('QueryReportHistoryDto', () => {
  it('defaults to the first page of 20, every kind', async () => {
    expect(await failedProperties({})).toEqual([]);
    expect(parse({})).toMatchObject({ page: 1, limit: 20 });
    expect(parse({}).kind).toBeUndefined();
  });

  it('reads page and limit from the query string', () => {
    expect(parse({ page: '3', limit: '50' })).toMatchObject({
      page: 3,
      limit: 50,
    });
  });

  it.each(['GENERAL_REPORT', 'TAX_PACKAGE'])('accepts kind %s', async kind => {
    expect(await failedProperties({ kind })).toEqual([]);
  });

  it.each(['general_report', 'PDF', ''])('rejects kind %p', async kind => {
    expect(await failedProperties({ kind })).toEqual(['kind']);
  });

  it.each([
    ['page', '0'],
    ['page', String(REPORT_HISTORY_MAX_PAGE + 1)],
    ['page', '1.5'],
    ['page', 'x'],
    ['limit', '0'],
    ['limit', '101'],
  ])('rejects %s=%s', async (property, value) => {
    expect(await failedProperties({ [property]: value })).toEqual([property]);
  });

  it('accepts the edges', async () => {
    expect(
      await failedProperties({
        page: String(REPORT_HISTORY_MAX_PAGE),
        limit: '100',
      }),
    ).toEqual([]);
    expect(await failedProperties({ page: '1', limit: '1' })).toEqual([]);
  });

  it('refuses a userId: the owner comes from the token', async () => {
    expect(await failedProperties({ userId: 'someone-else' })).toEqual([
      'userId',
    ]);
  });
});
