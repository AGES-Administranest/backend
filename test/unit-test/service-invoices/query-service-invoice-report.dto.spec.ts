import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { QueryServiceInvoiceReportDto } from '../../../src/modules/service-invoices/dto/query-service-invoice-report.dto';
import { REPORT_SEARCH_MAX_LENGTH } from '../../../src/modules/service-invoices/service-invoices.constants';

async function check(query: Record<string, unknown>) {
  const dto = plainToInstance(QueryServiceInvoiceReportDto, query);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, failing: errors.map(error => error.property) };
}

describe('QueryServiceInvoiceReportDto', () => {
  it('accepts no filter at all, with the default page', async () => {
    const { dto, failing } = await check({});

    expect(failing).toEqual([]);
    expect(dto).toMatchObject({ page: 1, limit: 50 });
  });

  it('accepts every filter together', async () => {
    const { failing } = await check({
      search: 'vet',
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      page: '2',
      limit: '5',
    });

    expect(failing).toEqual([]);
  });

  it('trims the search', async () => {
    expect((await check({ search: '  vet  ' })).dto.search).toBe('vet');
  });

  it.each(['2026-10-1', '20261001', '2026-02-30', '01/10/2026', 'today'])(
    'refuses %s as a date',
    async value => {
      expect((await check({ startDate: value })).failing).toEqual([
        'startDate',
      ]);
      expect((await check({ endDate: value })).failing).toEqual(['endDate']);
    },
  );

  it('refuses a search over the limit', async () => {
    const search = 'a'.repeat(REPORT_SEARCH_MAX_LENGTH + 1);

    expect((await check({ search })).failing).toEqual(['search']);
  });

  it.each([
    ['page', 0],
    ['page', 'x'],
    ['limit', 0],
    ['limit', 101],
  ])('refuses %s=%s', async (field, value) => {
    expect((await check({ [field]: value })).failing).toEqual([field]);
  });

  it('refuses a field it does not declare, such as the user id', async () => {
    expect((await check({ userId: 'someone-else' })).failing).toEqual([
      'userId',
    ]);
  });
});
