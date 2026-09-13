import {
  AdjustmentReason,
  MeasurementUnit,
  Prisma,
  StockMovementSource,
  StockMovementType,
} from '@prisma/client';

import { StockHistoryEntryEntity } from './stock-history-entry.entity';
import { StockHistoryRow } from '../stock-history.repository';

const { INBOUND, OUTBOUND } = StockMovementType;
const { MANUAL_PURCHASE, ORDER_IMPORT, APPOINTMENT, MANUAL_ADJUSTMENT } =
  StockMovementSource;

const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

/** Propofol consumed in Rex's castration, unless overridden. */
function historyRow(overrides: Partial<StockHistoryRow> = {}): StockHistoryRow {
  return {
    id: 'mov-1',
    userId: 'user-ana',
    itemId: 'item-propofol',
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
    item: {
      id: 'item-propofol',
      name: 'Propofol',
      unit: MeasurementUnit.AMPOULE,
    },
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

describe('StockHistoryEntryEntity.fromRow', () => {
  it('resolves an appointment consumption: item, patient, procedure and ids', () => {
    const entry = StockHistoryEntryEntity.fromRow(historyRow());

    expect(entry).toMatchObject({
      id: 'mov-1',
      itemId: 'item-propofol',
      itemName: 'Propofol',
      unit: MeasurementUnit.AMPOULE,
      type: OUTBOUND,
      source: APPOINTMENT,
      appointmentId: 'apt-1',
      appointment: {
        id: 'apt-1',
        patientName: 'Rex',
        procedureName: 'Castration',
        startsAt: new Date('2026-09-10T13:30:00.000Z'),
      },
      purchaseOrder: null,
      supplierName: null,
    });
    // The row's userId never reaches the wire.
    expect(entry).not.toHaveProperty('userId');
  });

  it('resolves an order import with the order number and its supplier', () => {
    const entry = StockHistoryEntryEntity.fromRow(
      historyRow({
        type: INBOUND,
        source: ORDER_IMPORT,
        appointmentId: null,
        appointment: null,
        purchaseOrderId: 'po-7',
        purchaseOrder: {
          id: 'po-7',
          number: 'PO-2026-007',
          supplier: { id: 'sup-1', name: 'VetPharma' },
        },
      }),
    );

    expect(entry.purchaseOrderId).toBe('po-7');
    expect(entry.purchaseOrder).toEqual({
      id: 'po-7',
      number: 'PO-2026-007',
      supplierName: 'VetPharma',
    });
    expect(entry.appointment).toBeNull();
  });

  it('uses the direct supplier of a manual purchase', () => {
    const entry = StockHistoryEntryEntity.fromRow(
      historyRow({
        type: INBOUND,
        source: MANUAL_PURCHASE,
        appointmentId: null,
        appointment: null,
        supplierId: 'sup-2',
        supplier: { id: 'sup-2', name: 'Farmácia do Bairro' },
      }),
    );

    expect(entry.supplierName).toBe('Farmácia do Bairro');
    expect(entry.purchaseOrder).toBeNull();
  });

  it('keeps the reason and no origin for a manual adjustment', () => {
    const entry = StockHistoryEntryEntity.fromRow(
      historyRow({
        source: MANUAL_ADJUSTMENT,
        adjustmentReason: AdjustmentReason.EXPIRATION,
        appointmentId: null,
        appointment: null,
      }),
    );

    expect(entry.adjustmentReason).toBe(AdjustmentReason.EXPIRATION);
    expect(entry.appointmentId).toBeNull();
    expect(entry.appointment).toBeNull();
    expect(entry.purchaseOrder).toBeNull();
    expect(entry.supplierName).toBeNull();
  });

  it('serializes decimals as strings and rounds the total to cents', () => {
    const entry = StockHistoryEntryEntity.fromRow(
      historyRow({ quantity: decimal('3'), unitCost: decimal('12.3456') }),
    );

    expect(entry.quantity).toBe('3');
    expect(entry.unitCost).toBe('12.3456');
    // exact 37.0368 → 37.04
    expect(entry.totalValue).toBe('37.04');
  });
});
