import { ApiProperty } from '@nestjs/swagger';
import {
  AdjustmentReason,
  MeasurementUnit,
  StockMovementSource,
  StockMovementType,
} from '@prisma/client';

import { movementValue } from '../domain/stock-summary.rules';
import { StockHistoryRow } from '../stock-history.repository';

/** The appointment a consumption came from (`source = APPOINTMENT`). */
export class StockHistoryAppointmentEntity {
  id!: string;

  patientName!: string | null;

  procedureName!: string | null;

  startsAt!: Date;
}

/** The purchase order an inbound came from (`source = ORDER_IMPORT`). */
export class StockHistoryPurchaseOrderEntity {
  id!: string;

  number!: string | null;

  supplierName!: string | null;
}

/**
 * One line of the stock history: the movement plus its origin already
 * resolved, so the app can show "Propofol · 3 ampoules · Castration (Rex)" and
 * navigate to the appointment or the purchase order by id.
 *
 * `Decimal` columns travel as strings so no precision is lost on the wire.
 */
export class StockHistoryEntryEntity {
  id!: string;

  itemId!: string;

  itemName!: string;

  @ApiProperty({ enum: MeasurementUnit })
  unit!: MeasurementUnit;

  lotId!: string | null;

  /** INBOUND adds to the balance, OUTBOUND subtracts */
  @ApiProperty({ enum: StockMovementType })
  type!: StockMovementType;

  @ApiProperty({ enum: StockMovementSource })
  source!: StockMovementSource;

  /** only when `source = MANUAL_ADJUSTMENT` */
  @ApiProperty({ enum: AdjustmentReason, nullable: true })
  adjustmentReason!: AdjustmentReason | null;

  /** always positive; the sign comes from `type` */
  @ApiProperty({ type: String, example: '3' })
  quantity!: string;

  /** cost snapshot at the time of the movement */
  @ApiProperty({ type: String, example: '12.5' })
  unitCost!: string;

  /** quantity × unitCost, in money (2 decimal places) */
  @ApiProperty({ type: String, example: '37.50' })
  totalValue!: string;

  occurredAt!: Date;

  notes!: string | null;

  /** origin ids, for navigation — present even when the record itself is gone */
  appointmentId!: string | null;

  purchaseOrderId!: string | null;

  purchaseInvoiceLineId!: string | null;

  @ApiProperty({ type: StockHistoryAppointmentEntity, nullable: true })
  appointment!: StockHistoryAppointmentEntity | null;

  @ApiProperty({ type: StockHistoryPurchaseOrderEntity, nullable: true })
  purchaseOrder!: StockHistoryPurchaseOrderEntity | null;

  /** supplier of a manual purchase (`source = MANUAL_PURCHASE`), when informed */
  supplierName!: string | null;

  static fromRow(row: StockHistoryRow): StockHistoryEntryEntity {
    return {
      id: row.id,
      itemId: row.itemId,
      itemName: row.item.name,
      unit: row.item.unit,
      lotId: row.lotId,
      type: row.type,
      source: row.source,
      adjustmentReason: row.adjustmentReason,
      quantity: row.quantity.toString(),
      unitCost: row.unitCost.toString(),
      totalValue: movementValue(row).toFixed(2),
      occurredAt: row.occurredAt,
      notes: row.notes,
      appointmentId: row.appointmentId,
      purchaseOrderId: row.purchaseOrderId,
      purchaseInvoiceLineId: row.purchaseInvoiceLineId,
      appointment: row.appointment && {
        id: row.appointment.id,
        patientName: row.appointment.patientName,
        procedureName: row.appointment.procedureName,
        startsAt: row.appointment.startsAt,
      },
      purchaseOrder: row.purchaseOrder && {
        id: row.purchaseOrder.id,
        number: row.purchaseOrder.number,
        supplierName: row.purchaseOrder.supplier?.name ?? null,
      },
      supplierName: row.supplier?.name ?? null,
    };
  }
}
