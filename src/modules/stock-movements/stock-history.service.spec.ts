import {
  AdjustmentReason,
  MeasurementUnit,
  Prisma,
  StockMovementSource,
  StockMovementType,
} from '@prisma/client';

import { QueryStockHistoryDto } from './dto/query-stock-history.dto';
import { StockHistoryRow, StockSummaryRow } from './stock-history.repository';
import { StockHistoryService } from './stock-history.service';
import { DomainError } from '../../shared/errors/domain-error';

const { INBOUND, OUTBOUND } = StockMovementType;
const { MANUAL_PURCHASE, APPOINTMENT, MANUAL_ADJUSTMENT } = StockMovementSource;

const ANA = { cognitoSub: 'sub-ana', email: 'ana@example.com' };
const ANA_ID = 'user-ana';
const ITEM_ID = 'item-propofol';

const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

function summaryRow(overrides: Partial<StockSummaryRow> = {}): StockSummaryRow {
  return {
    type: OUTBOUND,
    source: APPOINTMENT,
    adjustmentReason: null,
    quantity: decimal(1),
    unitCost: decimal(5),
    deletedAt: null,
    appointment: { procedureName: 'Castration' },
    ...overrides,
  };
}

function historyRow(overrides: Partial<StockHistoryRow> = {}): StockHistoryRow {
  return {
    id: 'mov-1',
    userId: ANA_ID,
    itemId: ITEM_ID,
    lotId: null,
    type: OUTBOUND,
    source: APPOINTMENT,
    adjustmentReason: null,
    quantity: decimal(3),
    unitCost: decimal(5),
    occurredAt: new Date('2026-09-10T14:00:00.000Z'),
    appointmentId: 'apt-1',
    purchaseOrderId: null,
    purchaseInvoiceLineId: null,
    supplierId: null,
    notes: null,
    createdAt: new Date('2026-09-10T14:00:01.000Z'),
    deletedAt: null,
    item: { id: ITEM_ID, name: 'Propofol', unit: MeasurementUnit.AMPOULE },
    appointment: {
      id: 'apt-1',
      patientName: 'Rex',
      procedureName: 'Castration',
      startsAt: new Date('2026-09-10T13:30:00.000Z'),
    },
    purchaseOrder: null,
    supplier: null,
    ...overrides,
  };
}

/** Same worked example as the domain spec: +10, −3, −2, −1 expired. */
const september: StockSummaryRow[] = [
  summaryRow({
    type: INBOUND,
    source: MANUAL_PURCHASE,
    quantity: decimal(10),
    appointment: null,
  }),
  summaryRow({ quantity: decimal(3) }),
  summaryRow({ quantity: decimal(2) }),
  summaryRow({
    source: MANUAL_ADJUSTMENT,
    adjustmentReason: AdjustmentReason.EXPIRATION,
    quantity: decimal(1),
    appointment: null,
  }),
];

function query(
  overrides: Partial<QueryStockHistoryDto> = {},
): QueryStockHistoryDto {
  return Object.assign(new QueryStockHistoryDto(), overrides);
}

describe('StockHistoryService', () => {
  let repository: {
    findItemById: jest.Mock;
    findPage: jest.Mock;
    count: jest.Mock;
    findForSummary: jest.Mock;
    sumQuantityByTypeBefore: jest.Mock;
  };
  let usersService: { findByCognitoSub: jest.Mock };
  let service: StockHistoryService;

  beforeEach(() => {
    repository = {
      findItemById: jest
        .fn()
        .mockResolvedValue({ id: ITEM_ID, userId: ANA_ID }),
      findPage: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findForSummary: jest.fn().mockResolvedValue([]),
      sumQuantityByTypeBefore: jest
        .fn()
        .mockResolvedValue({ inbound: null, outbound: null }),
    };
    usersService = {
      findByCognitoSub: jest.fn().mockResolvedValue({ id: ANA_ID }),
    };
    service = new StockHistoryService(
      repository as never,
      usersService as never,
    );
  });

  describe('listHistory', () => {
    it('scopes every query by the user resolved from the token (ADR-11)', async () => {
      await service.listHistory(ANA, query());

      expect(usersService.findByCognitoSub).toHaveBeenCalledWith('sub-ana');
      expect(repository.findPage).toHaveBeenCalledWith(
        ANA_ID,
        expect.anything(),
        expect.anything(),
      );
      expect(repository.count).toHaveBeenCalledWith(ANA_ID, expect.anything());
    });

    it('turns the query string into the repository filter and page request', async () => {
      await service.listHistory(
        ANA,
        query({
          itemId: ITEM_ID,
          startDate: '2026-09-01T00:00:00.000Z',
          endDate: '2026-09-30T23:59:59.999Z',
          type: OUTBOUND,
          source: APPOINTMENT,
          page: 2,
          limit: 50,
        }),
      );

      expect(repository.findPage).toHaveBeenCalledWith(
        ANA_ID,
        {
          itemId: ITEM_ID,
          from: new Date('2026-09-01T00:00:00.000Z'),
          to: new Date('2026-09-30T23:59:59.999Z'),
          type: OUTBOUND,
          source: APPOINTMENT,
        },
        { page: 2, limit: 50 },
      );
    });

    it('makes a date-only period cover its whole last day', async () => {
      await service.listHistory(
        ANA,
        query({ startDate: '2026-09-01', endDate: '2026-09-30' }),
      );

      const [, filter] = repository.findPage.mock.calls[0] as [
        string,
        { from: Date; to: Date },
      ];
      expect(filter.from.toISOString()).toBe('2026-09-01T00:00:00.000Z');
      expect(filter.to.toISOString()).toBe('2026-09-30T23:59:59.999Z');
    });

    it('returns the page as entities, with its total', async () => {
      repository.findPage.mockResolvedValue([
        historyRow({ id: 'm1' }),
        historyRow({ id: 'm2' }),
      ]);
      repository.count.mockResolvedValue(42);

      const result = await service.listHistory(
        ANA,
        query({ page: 3, limit: 2 }),
      );

      expect(result).toMatchObject({ page: 3, limit: 2, total: 42 });
      expect(result.data.map(entry => entry.id)).toEqual(['m1', 'm2']);
      expect(result.data[0]).toMatchObject({
        itemName: 'Propofol',
        totalValue: '15.00',
        appointment: { patientName: 'Rex' },
      });
    });

    it("answers 404 for an item that is not the user's, before touching the ledger", async () => {
      repository.findItemById.mockResolvedValue(null);

      await expect(
        service.listHistory(ANA, query({ itemId: 'item-of-someone-else' })),
      ).rejects.toMatchObject({
        kind: 'NOT_FOUND',
        code: 'ITEM_NOT_FOUND',
      } satisfies Partial<DomainError>);
      expect(repository.findPage).not.toHaveBeenCalled();
    });

    it('does not look the item up when no item was asked for', async () => {
      await service.listHistory(ANA, query());

      expect(repository.findItemById).not.toHaveBeenCalled();
    });

    it('lets USER_NOT_PROVISIONED from the users module through untouched', async () => {
      const notProvisioned = new DomainError(
        'NOT_FOUND',
        'USER_NOT_PROVISIONED',
        'no mirror yet',
      );
      usersService.findByCognitoSub.mockRejectedValue(notProvisioned);

      await expect(service.listHistory(ANA, query())).rejects.toBe(
        notProvisioned,
      );
    });
  });

  describe('summarize', () => {
    it('summarizes the period and, for an item, opens the balance from the ledger before it', async () => {
      repository.findForSummary.mockResolvedValue(september);
      // Before September: 6 in, 2 out → opening balance 4.
      repository.sumQuantityByTypeBefore.mockResolvedValue({
        inbound: decimal(6),
        outbound: decimal(2),
      });

      const report = await service.summarize(ANA, {
        itemId: ITEM_ID,
        startDate: '2026-09-01',
        endDate: '2026-09-30',
      });

      expect(report.inbound).toEqual({ quantity: '10', value: '50.00' });
      expect(report.outbound).toEqual({ quantity: '6', value: '30.00' });
      expect(report.consumptionByProcedure[0]).toMatchObject({
        procedureName: 'Castration',
      });
      expect(report.adjustmentsByReason[0]).toMatchObject({
        reason: AdjustmentReason.EXPIRATION,
      });
      expect(report.item).toEqual({
        openingBalance: '4',
        inbound: '10',
        outbound: '6',
        closingBalance: '8',
      });
      expect(repository.sumQuantityByTypeBefore).toHaveBeenCalledWith(
        ANA_ID,
        ITEM_ID,
        new Date('2026-09-01T00:00:00.000Z'),
      );
    });

    it('opens at zero when the period has no start date, without asking the database', async () => {
      repository.findForSummary.mockResolvedValue(september);

      const report = await service.summarize(ANA, { itemId: ITEM_ID });

      expect(report.item?.openingBalance).toBe('0');
      expect(report.item?.closingBalance).toBe('4');
      expect(repository.sumQuantityByTypeBefore).not.toHaveBeenCalled();
    });

    it('leaves the item block out when no item was asked for', async () => {
      repository.findForSummary.mockResolvedValue(september);

      const report = await service.summarize(ANA, { startDate: '2026-09-01' });

      expect(report.item).toBeNull();
      expect(repository.sumQuantityByTypeBefore).not.toHaveBeenCalled();
    });

    it("answers 404 for an item that is not the user's", async () => {
      repository.findItemById.mockResolvedValue(null);

      await expect(
        service.summarize(ANA, { itemId: 'item-of-someone-else' }),
      ).rejects.toMatchObject({ code: 'ITEM_NOT_FOUND' });
      expect(repository.findForSummary).not.toHaveBeenCalled();
    });
  });
});
