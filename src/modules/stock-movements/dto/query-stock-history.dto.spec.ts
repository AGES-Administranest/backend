import { StockMovementSource, StockMovementType } from '@prisma/client';
import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  QueryStockHistoryDto,
  STOCK_HISTORY_DEFAULT_LIMIT,
  STOCK_HISTORY_MAX_LIMIT,
} from './query-stock-history.dto';
import { StockPeriodFilterDto } from './stock-period-filter.dto';

/**
 * Runs a raw query object through the same two steps as the global
 * `ValidationPipe` in `main.ts`: `plainToInstance` (which applies `@Type` and
 * the class defaults) and then `validate` with `whitelist` +
 * `forbidNonWhitelisted`. Validating with different options would prove
 * nothing about the real route.
 */
async function parseQuery<T extends object>(
  dtoClass: ClassConstructor<T>,
  raw: Record<string, unknown>,
): Promise<{ dto: T; invalidFields: string[] }> {
  const dto = plainToInstance(dtoClass, raw);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, invalidFields: errors.map(error => error.property).sort() };
}

const ITEM_ID = '3f2c8a9e-1b4d-4c6e-9a7f-0d1e2f3a4b5c';

describe('QueryStockHistoryDto', () => {
  describe('with an empty query', () => {
    it('is valid and applies the pagination defaults', async () => {
      const { dto, invalidFields } = await parseQuery(QueryStockHistoryDto, {});

      expect(invalidFields).toEqual([]);
      expect(dto.page).toBe(1);
      expect(dto.limit).toBe(STOCK_HISTORY_DEFAULT_LIMIT);
      expect(dto.itemId).toBeUndefined();
      expect(dto.startDate).toBeUndefined();
      expect(dto.endDate).toBeUndefined();
      expect(dto.type).toBeUndefined();
      expect(dto.source).toBeUndefined();
    });
  });

  describe('period filter (inherited from StockPeriodFilterDto)', () => {
    it('accepts a uuid item and ISO 8601 dates, with or without time', async () => {
      const { dto, invalidFields } = await parseQuery(QueryStockHistoryDto, {
        itemId: ITEM_ID,
        startDate: '2026-09-01',
        endDate: '2026-09-30T23:59:59.999Z',
      });

      expect(invalidFields).toEqual([]);
      expect(dto.itemId).toBe(ITEM_ID);
      // Dates stay strings here: turning them into Date is the service's job.
      expect(dto.startDate).toBe('2026-09-01');
      expect(dto.endDate).toBe('2026-09-30T23:59:59.999Z');
    });

    it.each([
      ['itemId', 'not-a-uuid'],
      ['startDate', 'yesterday'],
      ['endDate', '30/09/2026'],
    ])('rejects an invalid %s (%p)', async (field, value) => {
      const { invalidFields } = await parseQuery(QueryStockHistoryDto, {
        [field]: value,
      });

      expect(invalidFields).toEqual([field]);
    });
  });

  describe('type and source', () => {
    it.each(Object.values(StockMovementType))('accepts type %s', async type => {
      const { invalidFields } = await parseQuery(QueryStockHistoryDto, {
        type,
      });

      expect(invalidFields).toEqual([]);
    });

    it.each(Object.values(StockMovementSource))(
      'accepts source %s',
      async source => {
        const { invalidFields } = await parseQuery(QueryStockHistoryDto, {
          source,
        });

        expect(invalidFields).toEqual([]);
      },
    );

    it('rejects values outside the enums, including the lowercase form the app uses internally', async () => {
      const { invalidFields } = await parseQuery(QueryStockHistoryDto, {
        type: 'inbound',
        source: 'purchase',
      });

      expect(invalidFields).toEqual(['source', 'type']);
    });
  });

  describe('pagination', () => {
    it('converts page and limit from query-string text to numbers', async () => {
      const { dto, invalidFields } = await parseQuery(QueryStockHistoryDto, {
        page: '3',
        limit: '50',
      });

      expect(invalidFields).toEqual([]);
      expect(dto.page).toBe(3);
      expect(dto.limit).toBe(50);
    });

    it('accepts the maximum page size', async () => {
      const { dto, invalidFields } = await parseQuery(QueryStockHistoryDto, {
        limit: String(STOCK_HISTORY_MAX_LIMIT),
      });

      expect(invalidFields).toEqual([]);
      expect(dto.limit).toBe(STOCK_HISTORY_MAX_LIMIT);
    });

    it.each([
      ['page', '0'],
      ['page', '-1'],
      ['page', '1.5'],
      ['page', 'two'],
      ['limit', '0'],
      ['limit', String(STOCK_HISTORY_MAX_LIMIT + 1)],
      ['limit', 'all'],
    ])('rejects %s=%s', async (field, value) => {
      const { invalidFields } = await parseQuery(QueryStockHistoryDto, {
        [field]: value,
      });

      expect(invalidFields).toEqual([field]);
    });
  });

  describe('fields outside the DTO', () => {
    it('rejects userId: the owner comes from the token, never from the query (ADR-11)', async () => {
      const { invalidFields } = await parseQuery(QueryStockHistoryDto, {
        userId: ITEM_ID,
      });

      expect(invalidFields).toEqual(['userId']);
    });

    it('reports every invalid field at once, not only the first', async () => {
      const { invalidFields } = await parseQuery(QueryStockHistoryDto, {
        itemId: 'x',
        page: '0',
        extra: 'y',
      });

      expect(invalidFields).toEqual(['extra', 'itemId', 'page']);
    });
  });
});

describe('StockPeriodFilterDto', () => {
  it('accepts the period fields on their own', async () => {
    const { invalidFields } = await parseQuery(StockPeriodFilterDto, {
      itemId: ITEM_ID,
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });

    expect(invalidFields).toEqual([]);
  });

  it('does not accept the history-only fields (pagination, type, source)', async () => {
    const { invalidFields } = await parseQuery(StockPeriodFilterDto, {
      page: '1',
      limit: '20',
      type: StockMovementType.INBOUND,
      source: StockMovementSource.APPOINTMENT,
    });

    expect(invalidFields).toEqual(['limit', 'page', 'source', 'type']);
  });
});
