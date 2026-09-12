import {
  AdjustmentReason,
  Item,
  ItemCategory,
  MeasurementUnit,
  Prisma,
  StockMovement,
  StockMovementSource,
  StockMovementType,
} from '@prisma/client';

import { TestUser } from './test-app';
import { PrismaService } from '../../src/infra/prisma/prisma.service';

/**
 * Writes straight to the tables the stock history reads. The e2e suite is
 * about reading, so it seeds the ledger directly instead of going through the
 * write endpoints (which live in another branch anyway).
 */

/** The local mirror the `x-test-user` header resolves to. */
export async function seedUser(
  prisma: PrismaService,
  user: TestUser,
): Promise<string> {
  const created = await prisma.user.create({
    data: {
      cognitoSub: user.cognitoSub,
      email: user.email,
      name: user.name ?? user.email,
    },
  });
  return created.id;
}

export function seedItem(
  prisma: PrismaService,
  userId: string,
  name: string,
): Promise<Item> {
  return prisma.item.create({
    data: {
      userId,
      name,
      unit: MeasurementUnit.AMPOULE,
      category: ItemCategory.MEDICATION,
    },
  });
}

export interface MovementSeed {
  type: StockMovementType;
  source: StockMovementSource;
  quantity: Prisma.Decimal.Value;
  /** defaults to 5, so values are quantity × 5 */
  unitCost?: Prisma.Decimal.Value;
  /** ISO 8601 */
  occurredAt: string;
  adjustmentReason?: AdjustmentReason;
  appointmentId?: string;
  purchaseOrderId?: string;
  supplierId?: string;
  deletedAt?: Date;
}

export function seedMovement(
  prisma: PrismaService,
  userId: string,
  itemId: string,
  seed: MovementSeed,
): Promise<StockMovement> {
  return prisma.stockMovement.create({
    data: {
      userId,
      itemId,
      type: seed.type,
      source: seed.source,
      quantity: new Prisma.Decimal(seed.quantity),
      unitCost: new Prisma.Decimal(seed.unitCost ?? 5),
      occurredAt: new Date(seed.occurredAt),
      adjustmentReason: seed.adjustmentReason ?? null,
      appointmentId: seed.appointmentId ?? null,
      purchaseOrderId: seed.purchaseOrderId ?? null,
      supplierId: seed.supplierId ?? null,
      deletedAt: seed.deletedAt ?? null,
    },
  });
}
