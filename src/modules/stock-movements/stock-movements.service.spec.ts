import {
  AdjustmentReason,
  Item,
  Prisma,
  StockMovement,
  StockMovementSource,
  StockMovementType,
  Supplier,
} from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';
import { CreateStockPurchaseDto } from './dto/create-stock-purchase.dto';
import { StockMovementsRepository } from './stock-movements.repository';
import { StockMovementsService } from './stock-movements.service';
import { DomainError } from '../../shared/errors/domain-error';
import { UsersService } from '../users';

const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

/**
 * Stateful fake: it keeps the ledger and the item cache so the balance the
 * service reads back is the one its own writes produced. A stateless mock would
 * let the "reduces the balance" and "clears the flag" tests pass while proving
 * nothing.
 */
class FakeRepository {
  readonly items = new Map<string, Item>();
  readonly suppliers = new Map<string, Supplier>();
  readonly movements: StockMovement[] = [];
  private sequence = 0;

  seedSupplier(id: string, userId: string): Supplier {
    const supplier = { id, userId, deletedAt: null } as unknown as Supplier;
    this.suppliers.set(id, supplier);
    return supplier;
  }

  seedItem(item: Partial<Item> & Pick<Item, 'id' | 'userId'>): Item {
    const full = {
      supplierId: null,
      unit: 'UNIT',
      name: 'Item',
      defaultUnitCost: decimal(10),
      minimumStock: null,
      currentQuantity: decimal(0),
      needsAdjustment: false,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...item,
    } as unknown as Item;
    this.items.set(full.id, full);
    return full;
  }

  findItemById(userId: string, itemId: string): Promise<Item | null> {
    const item = this.items.get(itemId);
    return Promise.resolve(item && item.userId === userId ? item : null);
  }

  async recordWithLock<T>(
    itemId: string,
    fn: (tx: unknown, lockedItem: Item | undefined) => Promise<T>,
  ): Promise<T> {
    const item = this.items.get(itemId);
    return fn(undefined, item);
  }

  findMovementsByItem(
    userId: string,
    itemId: string,
  ): Promise<StockMovement[]> {
    return Promise.resolve(
      this.movements.filter(m => m.userId === userId && m.itemId === itemId),
    );
  }

  create(
    data: Prisma.StockMovementUncheckedCreateInput,
  ): Promise<StockMovement> {
    const movement = {
      id: `mov-${++this.sequence}`,
      lotId: null,
      adjustmentReason: null,
      appointmentId: null,
      purchaseOrderId: null,
      purchaseInvoiceLineId: null,
      supplierId: null,
      notes: null,
      createdAt: new Date(),
      deletedAt: null,
      ...data,
      quantity: decimal(data.quantity as Prisma.Decimal.Value),
      unitCost: decimal(data.unitCost as Prisma.Decimal.Value),
    } as StockMovement;
    this.movements.push(movement);
    return Promise.resolve(movement);
  }

  updateItemQuantity(
    itemId: string,
    currentQuantity: Prisma.Decimal,
  ): Promise<Item> {
    const item = this.items.get(itemId)!;
    item.currentQuantity = currentQuantity;
    return Promise.resolve(item);
  }

  setItemNeedsAdjustment(
    itemId: string,
    needsAdjustment: boolean,
  ): Promise<Item> {
    const item = this.items.get(itemId)!;
    item.needsAdjustment = needsAdjustment;
    return Promise.resolve(item);
  }

  findSupplierById(
    userId: string,
    supplierId: string,
  ): Promise<Supplier | null> {
    const supplier = this.suppliers.get(supplierId);
    return Promise.resolve(
      supplier && supplier.userId === userId ? supplier : null,
    );
  }

  applyInboundPurchaseToItem(
    itemId: string,
    unitCost: Prisma.Decimal,
  ): Promise<Item> {
    const item = this.items.get(itemId)!;
    item.defaultUnitCost = unitCost;
    item.active = true;
    return Promise.resolve(item);
  }
}

const fakeUsers = (map: Record<string, string>) =>
  ({
    findByCognitoSub: (sub: string) => {
      const id = map[sub];
      if (!id) {
        return Promise.reject(
          new DomainError('NOT_FOUND', 'USER_NOT_PROVISIONED', 'no mirror'),
        );
      }
      return Promise.resolve({ id });
    },
  }) as unknown as UsersService;

const build = (users: Record<string, string> = { 'sub-ana': 'user-ana' }) => {
  const repository = new FakeRepository();
  const service = new StockMovementsService(
    repository as unknown as StockMovementsRepository,
    fakeUsers(users),
  );
  return { repository, service };
};

const dto = (
  over: Partial<CreateStockAdjustmentDto> = {},
): CreateStockAdjustmentDto => ({
  itemId: 'item-1',
  quantity: 3,
  adjustmentReason: AdjustmentReason.LOSS,
  date: '2026-09-10T00:00:00.000Z',
  ...over,
});

const purchaseDto = (
  over: Partial<CreateStockPurchaseDto> = {},
): CreateStockPurchaseDto => ({
  itemId: 'item-1',
  quantity: 5,
  unitValue: 8,
  date: '2026-09-09T00:00:00.000Z',
  ...over,
});

const ana: { cognitoSub: string; email: string } = {
  cognitoSub: 'sub-ana',
  email: 'ana@example.com',
};

describe('StockMovementsService.registerAdjustment (US11)', () => {
  it('records an OUTBOUND MANUAL_ADJUSTMENT that reduces the balance', async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: 'user-ana' });
    await service.record('user-ana', inbound('item-1', 10));

    const movement = await service.registerAdjustment(
      ana,
      dto({ quantity: 4 }),
    );

    expect(movement.type).toBe(StockMovementType.OUTBOUND);
    expect(movement.source).toBe(StockMovementSource.MANUAL_ADJUSTMENT);
    expect(movement.adjustmentReason).toBe(AdjustmentReason.LOSS);
    expect(repository.items.get('item-1')!.currentQuantity.toNumber()).toBe(6);
  });

  it('snapshots the item current unit cost onto the movement', async () => {
    const { repository, service } = build();
    repository.seedItem({
      id: 'item-1',
      userId: 'user-ana',
      defaultUnitCost: decimal('12.5000'),
    });
    await service.record('user-ana', inbound('item-1', 10));

    const movement = await service.registerAdjustment(ana, dto());

    expect(movement.unitCost).toBe('12.5');
  });

  it('clears needsAdjustment once the adjustment lands (closes the US10 loop)', async () => {
    const { repository, service } = build();
    repository.seedItem({
      id: 'item-1',
      userId: 'user-ana',
      needsAdjustment: true,
    });
    await service.record('user-ana', inbound('item-1', 10));

    await service.registerAdjustment(ana, dto({ quantity: 2 }));

    expect(repository.items.get('item-1')!.needsAdjustment).toBe(false);
  });

  it('rejects an adjustment that would leave the balance negative', async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: 'user-ana' });
    await service.record('user-ana', inbound('item-1', 3));

    const rejected = service.registerAdjustment(ana, dto({ quantity: 5 }));

    await expect(rejected).rejects.toMatchObject({
      kind: 'INVALID_INPUT',
      code: 'STOCK_ADJUSTMENT_NEGATIVE_BALANCE',
    });
    await expect(rejected).rejects.toBeInstanceOf(DomainError);
    expect(repository.movements).toHaveLength(1);
  });

  it("does not let a user adjust another user's item (ADR-11)", async () => {
    const { repository, service } = build({
      'sub-ana': 'user-ana',
      'sub-bob': 'user-bob',
    });
    repository.seedItem({ id: 'item-1', userId: 'user-bob' });
    await service.record('user-bob', inbound('item-1', 10));

    const rejected = service.registerAdjustment(
      { cognitoSub: 'sub-ana', email: 'ana@example.com' },
      dto(),
    );

    await expect(rejected).rejects.toMatchObject({
      kind: 'NOT_FOUND',
      code: 'ITEM_NOT_FOUND',
    });
  });
});

describe('StockMovementsService.registerPurchase (manual purchase entry)', () => {
  it('records an INBOUND MANUAL_PURCHASE that adds to the balance', async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: 'user-ana' });

    const movement = await service.registerPurchase(
      ana,
      purchaseDto({ quantity: 7 }),
    );

    expect(movement.type).toBe(StockMovementType.INBOUND);
    expect(movement.source).toBe(StockMovementSource.MANUAL_PURCHASE);
    expect(repository.items.get('item-1')!.currentQuantity.toNumber()).toBe(7);
  });

  it('updates the item unit cost to the price paid (US10 rule)', async () => {
    const { repository, service } = build();
    repository.seedItem({
      id: 'item-1',
      userId: 'user-ana',
      defaultUnitCost: decimal(10),
    });

    const movement = await service.registerPurchase(
      ana,
      purchaseDto({ unitValue: 13.5 }),
    );

    expect(movement.unitCost).toBe('13.5');
    expect(repository.items.get('item-1')!.defaultUnitCost!.toNumber()).toBe(
      13.5,
    );
  });

  it('accepts an optional supplier that belongs to the user', async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: 'user-ana' });
    repository.seedSupplier('sup-1', 'user-ana');

    const movement = await service.registerPurchase(
      ana,
      purchaseDto({ supplierId: 'sup-1' }),
    );

    expect(movement.supplierId).toBe('sup-1');
  });

  it('rejects a supplier that belongs to another user', async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: 'user-ana' });
    repository.seedSupplier('sup-bob', 'user-bob');

    const rejected = service.registerPurchase(
      ana,
      purchaseDto({ supplierId: 'sup-bob' }),
    );

    await expect(rejected).rejects.toMatchObject({
      kind: 'INVALID_REFERENCE',
      code: 'SUPPLIER_NOT_FOUND',
    });
    expect(repository.movements).toHaveLength(0);
  });

  it('rejects a future date but accepts a backdated one', async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: 'user-ana' });

    await expect(
      service.registerPurchase(ana, purchaseDto({ date: '2099-01-01' })),
    ).rejects.toMatchObject({
      kind: 'INVALID_INPUT',
      code: 'STOCK_MOVEMENT_DATE_IN_FUTURE',
    });

    const backdated = await service.registerPurchase(
      ana,
      purchaseDto({ date: '2020-01-01' }),
    );
    expect(backdated.occurredAt).toEqual(new Date('2020-01-01'));
  });

  it('reactivates an inactive item', async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: 'user-ana', active: false });

    await service.registerPurchase(ana, purchaseDto());

    expect(repository.items.get('item-1')!.active).toBe(true);
  });

  it('leaves the balance above the minimum and no longer below it', async () => {
    const { repository, service } = build();
    repository.seedItem({
      id: 'item-1',
      userId: 'user-ana',
      minimumStock: decimal(5),
    });
    await service.record(
      'user-ana',
      {
        itemId: 'item-1',
        type: StockMovementType.OUTBOUND,
        source: StockMovementSource.CORRECTION_REVERSAL,
        quantity: 2,
        unitCost: 10,
        occurredAt: new Date(),
      },
      { allowNegativeBalance: true },
    );

    await service.registerPurchase(ana, purchaseDto({ quantity: 20 }));

    const result = await service.record('user-ana', inbound('item-1', 0.001));
    expect(result.belowMinimum).toBe(false);
  });

  it('does not clear needsAdjustment (only the adjustment does, ADR-10)', async () => {
    const { repository, service } = build();
    repository.seedItem({
      id: 'item-1',
      userId: 'user-ana',
      needsAdjustment: true,
    });

    await service.registerPurchase(ana, purchaseDto());

    expect(repository.items.get('item-1')!.needsAdjustment).toBe(true);
  });

  it("does not let a user buy into another user's item (ADR-11)", async () => {
    const { repository, service } = build({
      'sub-ana': 'user-ana',
      'sub-bob': 'user-bob',
    });
    repository.seedItem({ id: 'item-1', userId: 'user-bob' });

    await expect(
      service.registerPurchase(ana, purchaseDto()),
    ).rejects.toMatchObject({ kind: 'NOT_FOUND', code: 'ITEM_NOT_FOUND' });
  });
});

describe('StockMovementsService.record (central ledger)', () => {
  it('flags the minimum-stock check when the balance crosses minimumStock', async () => {
    const { repository, service } = build();
    repository.seedItem({
      id: 'item-1',
      userId: 'user-ana',
      minimumStock: decimal(5),
    });
    await service.record('user-ana', inbound('item-1', 8));

    const result = await service.record('user-ana', {
      itemId: 'item-1',
      type: StockMovementType.OUTBOUND,
      source: StockMovementSource.MANUAL_ADJUSTMENT,
      adjustmentReason: AdjustmentReason.BREAKAGE,
      quantity: 4,
      unitCost: 10,
      occurredAt: new Date(),
    });

    expect(result.balance.toNumber()).toBe(4);
    expect(result.belowMinimum).toBe(true);
  });

  it('turns on needsAdjustment when the balance goes negative', async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: 'user-ana' });

    await service.record(
      'user-ana',
      {
        itemId: 'item-1',
        type: StockMovementType.OUTBOUND,
        source: StockMovementSource.CORRECTION_REVERSAL,
        quantity: 2,
        unitCost: 10,
        occurredAt: new Date(),
      },
      { allowNegativeBalance: true },
    );

    expect(repository.items.get('item-1')!.needsAdjustment).toBe(true);
  });
});

describe('CreateStockAdjustmentDto', () => {
  const parse = (raw: unknown) =>
    validate(plainToInstance(CreateStockAdjustmentDto, raw));

  it('rejects a missing reason', async () => {
    const errors = await parse({
      itemId: '11111111-1111-4111-8111-111111111111',
      quantity: 1,
      date: '2026-09-10',
    });
    expect(errors.some(e => e.property === 'adjustmentReason')).toBe(true);
  });

  it('requires notes when the reason is OTHER', async () => {
    const errors = await parse({
      itemId: '11111111-1111-4111-8111-111111111111',
      quantity: 1,
      adjustmentReason: AdjustmentReason.OTHER,
      date: '2026-09-10',
    });
    expect(errors.some(e => e.property === 'notes')).toBe(true);
  });

  it('accepts OTHER with notes', async () => {
    const errors = await parse({
      itemId: '11111111-1111-4111-8111-111111111111',
      quantity: 1,
      adjustmentReason: AdjustmentReason.OTHER,
      notes: 'found spoiled in the back',
      date: '2026-09-10',
    });
    expect(errors).toHaveLength(0);
  });
});

describe('CreateStockPurchaseDto', () => {
  const parse = (raw: unknown) =>
    validate(plainToInstance(CreateStockPurchaseDto, raw));

  const valid = {
    itemId: '11111111-1111-4111-8111-111111111111',
    quantity: 2,
    unitValue: 9.9,
    date: '2026-09-09',
  };

  it('accepts a valid payload without a supplier', async () => {
    expect(await parse(valid)).toHaveLength(0);
  });

  it('rejects a missing or non-positive unitValue', async () => {
    const missing = await parse({ ...valid, unitValue: undefined });
    expect(missing.some(e => e.property === 'unitValue')).toBe(true);

    const negative = await parse({ ...valid, unitValue: -1 });
    expect(negative.some(e => e.property === 'unitValue')).toBe(true);
  });

  it('rejects a non-positive quantity', async () => {
    const errors = await parse({ ...valid, quantity: 0 });
    expect(errors.some(e => e.property === 'quantity')).toBe(true);
  });

  it('rejects a supplierId that is not a uuid', async () => {
    const errors = await parse({ ...valid, supplierId: 'not-a-uuid' });
    expect(errors.some(e => e.property === 'supplierId')).toBe(true);
  });
});

function inbound(itemId: string, quantity: number) {
  return {
    itemId,
    type: StockMovementType.INBOUND,
    source: StockMovementSource.MANUAL_PURCHASE,
    quantity,
    unitCost: 10,
    occurredAt: new Date(),
  };
}

describe('StockMovementsService.reconcileItemBalance (support routine)', () => {
  it('reports no divergence when the cache already matches the ledger', async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: 'user-ana' });
    await service.record('user-ana', inbound('item-1', 10));

    const result = await service.reconcileItemBalance('user-ana', 'item-1');

    expect(result.wasDivergent).toBe(false);
    expect(result.reconciledBalance.toNumber()).toBe(10);
  });

  it('corrects the cache when it drifted from the ledger', async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: 'user-ana' });
    await service.record('user-ana', inbound('item-1', 10));

    // simulates external drift: someone touched currentQuantity outside record()
    repository.items.get('item-1')!.currentQuantity = decimal(999);

    const result = await service.reconcileItemBalance('user-ana', 'item-1');

    expect(result.wasDivergent).toBe(true);
    expect(result.previousBalance.toNumber()).toBe(999);
    expect(result.reconciledBalance.toNumber()).toBe(10);
    expect(repository.items.get('item-1')!.currentQuantity.toNumber()).toBe(10);
  });

  it('throws when the item does not exist for the user', async () => {
    const { service } = build();
    await expect(
      service.reconcileItemBalance('user-ana', 'missing'),
    ).rejects.toMatchObject({ code: 'ITEM_NOT_FOUND' });
  });
});
