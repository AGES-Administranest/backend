import { ApiProperty } from '@nestjs/swagger';
import { AdjustmentReason, StockMovementType } from '@prisma/client';

import {
  type AdjustmentByReason,
  type PeriodBalance,
  type PeriodSummary,
  type ProcedureConsumption,
  type QuantityAndValue,
} from '../domain/stock-summary.rules';

/** A quantity and what it is worth. Strings: see `StockHistoryEntryEntity`. */
export class QuantityAndValueEntity {
  @ApiProperty({ type: String, example: '10' })
  quantity!: string;

  /** money, 2 decimal places */
  @ApiProperty({ type: String, example: '50.00' })
  value!: string;

  static from(totals: QuantityAndValue): QuantityAndValueEntity {
    return {
      quantity: totals.quantity.toString(),
      value: totals.value.toFixed(2),
    };
  }
}

export class ProcedureConsumptionEntity extends QuantityAndValueEntity {
  /** `null` when the appointment had no procedure name */
  procedureName!: string | null;

  static fromConsumption(
    entry: ProcedureConsumption,
  ): ProcedureConsumptionEntity {
    return {
      ...QuantityAndValueEntity.from(entry),
      procedureName: entry.procedureName,
    };
  }
}

export class AdjustmentByReasonEntity extends QuantityAndValueEntity {
  @ApiProperty({ enum: AdjustmentReason })
  reason!: AdjustmentReason;

  /** OUTBOUND is a loss; INBOUND is a count that found more than the system had */
  @ApiProperty({ enum: StockMovementType })
  type!: StockMovementType;

  static fromAdjustment(entry: AdjustmentByReason): AdjustmentByReasonEntity {
    return {
      ...QuantityAndValueEntity.from(entry),
      reason: entry.reason,
      type: entry.type,
    };
  }
}

/** Balance of one item across the period, from the ledger (never from the cache). */
export class ItemPeriodBalanceEntity {
  @ApiProperty({ type: String, example: '4' })
  openingBalance!: string;

  @ApiProperty({ type: String, example: '10' })
  inbound!: string;

  @ApiProperty({ type: String, example: '6' })
  outbound!: string;

  @ApiProperty({ type: String, example: '8' })
  closingBalance!: string;

  static from(balance: PeriodBalance): ItemPeriodBalanceEntity {
    return {
      openingBalance: balance.openingBalance.toString(),
      inbound: balance.inbound.toString(),
      outbound: balance.outbound.toString(),
      closingBalance: balance.closingBalance.toString(),
    };
  }
}

/** The consolidated view of a period (`GET /stock-movements/summary`). */
export class StockSummaryEntity {
  /** every INBOUND movement, whatever the source */
  inbound!: QuantityAndValueEntity;

  /** every OUTBOUND movement, whatever the source */
  outbound!: QuantityAndValueEntity;

  /** consumption in appointments, grouped by procedure, largest value first */
  @ApiProperty({ type: [ProcedureConsumptionEntity] })
  consumptionByProcedure!: ProcedureConsumptionEntity[];

  /** manual adjustments grouped by reason and direction, largest value first */
  @ApiProperty({ type: [AdjustmentByReasonEntity] })
  adjustmentsByReason!: AdjustmentByReasonEntity[];

  /** only when the query named an item */
  @ApiProperty({ type: ItemPeriodBalanceEntity, nullable: true })
  item!: ItemPeriodBalanceEntity | null;

  static from(
    summary: PeriodSummary,
    item: PeriodBalance | null,
  ): StockSummaryEntity {
    return {
      inbound: QuantityAndValueEntity.from(summary.inbound),
      outbound: QuantityAndValueEntity.from(summary.outbound),
      consumptionByProcedure: summary.consumptionByProcedure.map(entry =>
        ProcedureConsumptionEntity.fromConsumption(entry),
      ),
      adjustmentsByReason: summary.adjustmentsByReason.map(entry =>
        AdjustmentByReasonEntity.fromAdjustment(entry),
      ),
      item: item && ItemPeriodBalanceEntity.from(item),
    };
  }
}
