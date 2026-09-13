import { Injectable } from '@nestjs/common';
import {
  AdjustmentReason,
  Prisma,
  StockMovement,
  StockMovementSource,
  StockMovementType,
} from '@prisma/client';

import {
  type DecimalInput,
  assertPositiveQuantity,
  assertSufficientBalance,
  assertValidMovement,
  balanceRequiresAdjustment,
  stockBalance,
} from './domain/stock-movement.rules';
import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';
import { CreateStockPurchaseDto } from './dto/create-stock-purchase.dto';
import { StockMovementEntity } from './entities/stock-movement.entity';
import { StockMovementsRepository } from './stock-movements.repository';
import { DomainError } from '../../shared/errors/domain-error';

/** Everything the central ledger needs to record one movement. */
export interface RecordMovementInput {
  itemId: string;
  lotId?: string | null;
  type: StockMovementType;
  source: StockMovementSource;
  /** positive magnitude — the sign comes from `type` */
  quantity: DecimalInput;
  /** cost snapshot for the movement */
  unitCost: DecimalInput;
  occurredAt: Date;
  adjustmentReason?: AdjustmentReason | null;
  appointmentId?: string | null;
  purchaseOrderId?: string | null;
  supplierId?: string | null;
  notes?: string | null;
}

export interface RecordMovementResult {
  movement: StockMovement;
  /** item balance after the movement, from the ledger (ADR-10) */
  balance: Prisma.Decimal;
  /** the new balance dropped below `item.minimumStock` */
  belowMinimum: boolean;
  /** the movement flipped (or kept) `item.needsAdjustment` to true — US10 alert */
  needsAdjustment: boolean;
}

/**
 * The stock ledger's single write path.
 *
 * `record` is the one place a `stock_movement` row is created: it persists the
 * movement, recomputes the balance from the ledger, refreshes the
 * `item.currentQuantity` cache, runs the minimum-stock check and flips
 * `needsAdjustment` when the balance goes negative (ADR-10, US10). Every use
 * case — the manual adjustment here, and the appointment/purchase flows later —
 * goes through it. Knows nothing about HTTP: failures are `DomainError` (ADR-07).
 */
@Injectable()
export class StockMovementsService {
  constructor(private readonly repository: StockMovementsRepository) {}

  async record(
    userId: string,
    input: RecordMovementInput,
    options: {
      allowNegativeBalance?: boolean;
      clearsNeedsAdjustment?: boolean;
      additionalWrites?: (tx: Prisma.TransactionClient) => Promise<void>;
    } = {},
  ): Promise<RecordMovementResult> {
    assertValidMovement({
      type: input.type,
      source: input.source,
      quantity: input.quantity,
      adjustmentReason: input.adjustmentReason ?? null,
      appointmentId: input.appointmentId ?? null,
      purchaseOrderId: input.purchaseOrderId ?? null,
    });

    return this.repository.recordWithLock(
      input.itemId,
      async (tx, lockedItem) => {
        if (
          !lockedItem ||
          lockedItem.userId !== userId ||
          lockedItem.deletedAt
        ) {
          throw this.itemNotFound(input.itemId);
        }

        const currentBalance = stockBalance(
          await this.repository.findMovementsByItem(userId, input.itemId, tx),
        );

        const resultingBalance = assertSufficientBalance(
          currentBalance,
          { type: input.type, quantity: input.quantity },
          { allowNegativeBalance: options.allowNegativeBalance ?? false },
        );

        const movement = await this.repository.create(
          {
            userId,
            itemId: input.itemId,
            lotId: input.lotId ?? null,
            type: input.type,
            source: input.source,
            adjustmentReason: input.adjustmentReason ?? null,
            appointmentId: input.appointmentId ?? null,
            purchaseOrderId: input.purchaseOrderId ?? null,
            quantity: new Prisma.Decimal(input.quantity),
            unitCost: new Prisma.Decimal(input.unitCost),
            occurredAt: input.occurredAt,
            supplierId: input.supplierId ?? null,
            notes: input.notes ?? null,
          },
          tx,
        );

        await this.repository.updateItemQuantity(
          input.itemId,
          resultingBalance,
          tx,
        );

        const balanceIsNegative = balanceRequiresAdjustment(resultingBalance);
        let needsAdjustment = lockedItem.needsAdjustment;

        if (balanceIsNegative && !lockedItem.needsAdjustment) {
          needsAdjustment = true;
          await this.repository.setItemNeedsAdjustment(input.itemId, true, tx);
        } else if (
          !balanceIsNegative &&
          lockedItem.needsAdjustment &&
          options.clearsNeedsAdjustment
        ) {
          needsAdjustment = false;
          await this.repository.setItemNeedsAdjustment(input.itemId, false, tx);
        }

        if (options.additionalWrites) {
          await options.additionalWrites(tx);
        }

        const belowMinimum =
          lockedItem.minimumStock != null &&
          resultingBalance.lessThan(lockedItem.minimumStock);

        return {
          movement,
          balance: resultingBalance,
          belowMinimum,
          needsAdjustment,
        };
      },
    );
  }

  /**
   * Verification/support routine (not part of the write path): recomputes an
   * item's balance from the full movement history and reconciles
   * `item.currentQuantity` if it drifted. Useful in tests and in support when
   * investigating a suspected divergence between the ledger and the cache.
   */
  async reconcileItemBalance(userId: string, itemId: string) {
    return this.repository.recordWithLock(itemId, async (tx, lockedItem) => {
      if (!lockedItem || lockedItem.userId !== userId)
        throw this.itemNotFound(itemId);

      const movements = await this.repository.findMovementsByItem(
        userId,
        itemId,
        tx,
      );
      const reconciledBalance = stockBalance(movements);
      const previousBalance = lockedItem.currentQuantity;
      const wasDivergent = !previousBalance.equals(reconciledBalance);

      if (wasDivergent) {
        await this.repository.updateItemQuantity(itemId, reconciledBalance, tx);
        const needsAdjustment = balanceRequiresAdjustment(reconciledBalance);
        if (needsAdjustment !== lockedItem.needsAdjustment) {
          await this.repository.setItemNeedsAdjustment(
            itemId,
            needsAdjustment,
            tx,
          );
        }
      }

      return { previousBalance, reconciledBalance, wasDivergent };
    });
  }

  /**
   * US11: register a manual outbound adjustment (loss / expiration / breakage /
   * other) and close the loop opened by a US10 correction — if the item was
   * flagged `needsAdjustment`, the flag is cleared once the movement lands.
   */
  async registerAdjustment(
    userId: string,
    dto: CreateStockAdjustmentDto,
  ): Promise<StockMovementEntity> {
    const item = await this.repository.findItemById(userId, dto.itemId);
    if (!item) throw this.itemNotFound(dto.itemId);

    const quantity = assertPositiveQuantity(dto.quantity);

    // "custo unitário do item no momento" (US11): the item's current unit cost.
    const unitCost = item.defaultUnitCost ?? new Prisma.Decimal(0);

    const { movement } = await this.record(
      userId,
      {
        itemId: dto.itemId,
        type: StockMovementType.OUTBOUND,
        source: StockMovementSource.MANUAL_ADJUSTMENT,
        adjustmentReason: dto.adjustmentReason,
        quantity,
        unitCost,
        occurredAt: new Date(dto.date),
        notes: dto.notes ?? null,
      },
      { clearsNeedsAdjustment: true },
    );

    return StockMovementEntity.fromModel(movement);
  }

  /**
   * Manual purchase entry: a purchase typed in by hand, for the cases with no
   * order or invoice to import (over-the-counter, a supplier that issues no
   * PDF). Delegates to `record` (INBOUND / MANUAL_PURCHASE), then updates the
   * item's cost to the latest purchase price (same rule as the order import,
   * US10) and reactivates the item if it was inactive.
   *
   * Note: a manual purchase is also an EXPENSE / MANUAL financial event (money
   * left to buy supplies). US03 owns that; it is intentionally NOT emitted here
   * until the financial module exists.
   */
  async registerPurchase(
    userId: string,
    dto: CreateStockPurchaseDto,
  ): Promise<StockMovementEntity> {
    const item = await this.repository.findItemById(userId, dto.itemId);
    if (!item) throw this.itemNotFound(dto.itemId);

    const occurredAt = new Date(dto.date);
    if (occurredAt.getTime() > Date.now()) {
      throw new DomainError(
        'INVALID_INPUT',
        'STOCK_MOVEMENT_DATE_IN_FUTURE',
        'A data da compra não pode estar no futuro.',
        { date: dto.date },
      );
    }

    if (dto.supplierId) {
      const supplier = await this.repository.findSupplierById(
        userId,
        dto.supplierId,
      );
      if (!supplier) {
        throw new DomainError(
          'INVALID_REFERENCE',
          'SUPPLIER_NOT_FOUND',
          'Fornecedor não encontrado. Cadastre o fornecedor antes de vincular a compra.',
          { supplierId: dto.supplierId },
        );
      }
    }

    const unitCost = new Prisma.Decimal(dto.unitValue);

    const { movement } = await this.record(
      userId,
      {
        itemId: dto.itemId,
        type: StockMovementType.INBOUND,
        source: StockMovementSource.MANUAL_PURCHASE,
        quantity: dto.quantity,
        unitCost,
        occurredAt,
        supplierId: dto.supplierId ?? null,
        notes: dto.notes ?? null,
      },
      {
        // Latest purchase price wins only if this purchase is not older than
        // the most recent inbound already recorded — a backdated entry must
        // not overwrite a newer price (review point #4).
        additionalWrites: async tx => {
          const movements = await this.repository.findMovementsByItem(
            userId,
            dto.itemId,
            tx,
          );

          const lastPurchase = movements
            .filter(m => m.type === StockMovementType.INBOUND)
            .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];

          const isLatestPrice =
            !lastPurchase ||
            occurredAt.getTime() >= lastPurchase.occurredAt.getTime();

          if (isLatestPrice) {
            await this.repository.applyInboundPurchaseToItem(
              dto.itemId,
              unitCost,
              tx,
            );
          }
        },
      },
    );

    return StockMovementEntity.fromModel(movement);
  }

  private itemNotFound(itemId: string) {
    return new DomainError(
      'NOT_FOUND',
      'ITEM_NOT_FOUND',
      `Item ${itemId} not found`,
      { itemId },
    );
  }
}
