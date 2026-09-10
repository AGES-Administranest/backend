import {
  AdjustmentReason,
  StockMovement,
  StockMovementSource,
  StockMovementType,
} from '@prisma/client';

/**
 * The shape of a stock movement as the API returns it. `Decimal` columns are
 * serialized as strings so no precision is lost on the wire.
 */
export class StockMovementEntity {
  /** Identificador único da movimentação */
  id!: string;

  /** Item movimentado */
  itemId!: string;

  /** Lote de origem, quando aplicável */
  lotId!: string | null;

  /** Sentido da movimentação (INBOUND soma, OUTBOUND subtrai) */
  type!: StockMovementType;

  /** Origem da movimentação */
  source!: StockMovementSource;

  /** Motivo do ajuste — preenchido apenas quando `source = MANUAL_ADJUSTMENT` */
  adjustmentReason!: AdjustmentReason | null;

  /** Magnitude sempre positiva; o sinal no saldo vem de `type` */
  quantity!: string;

  /** Custo unitário registrado no momento da movimentação */
  unitCost!: string;

  /** Data em que a movimentação ocorreu */
  occurredAt!: Date;

  /** Observações livres */
  notes!: string | null;

  static fromModel(movement: StockMovement): StockMovementEntity {
    return {
      id: movement.id,
      itemId: movement.itemId,
      lotId: movement.lotId,
      type: movement.type,
      source: movement.source,
      adjustmentReason: movement.adjustmentReason,
      quantity: movement.quantity.toString(),
      unitCost: movement.unitCost.toString(),
      occurredAt: movement.occurredAt,
      notes: movement.notes,
    };
  }
}
