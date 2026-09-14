import {
  AdjustmentReason,
  Item,
  Prisma,
  StockMovementSource,
  StockMovementType,
} from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';
import { CreateStockPurchaseDto } from './dto/create-stock-purchase.dto';
import { QueryStockMovementDto } from './dto/query-stock-movement.dto';
import {
  MovementWithContext,
  StockMovementsRepository,
} from './stock-movements.repository';
import {
  RecordMovementInput,
  StockMovementsService,
} from './stock-movements.service';
import { DomainError } from '../../shared/errors/domain-error';

const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

/**
 * Stateful fake: it keeps the ledger and the item cache, so the balance the
 * service reads back is the one its own writes produced. A stateless mock would
 * let "reduces the balance" and "rolls the batch back" pass while proving
 * nothing.
 *
 * The one thing it cannot model is the row lock — that is what the e2e in
 * `test/unit-test/stock-movements/` is for, against a real Postgres.
 */
class FakeRepository {
  readonly items = new Map<string, Item>();
  readonly movements: MovementWithContext[] = [];
  readonly suppliers = new Map<string, string>();
  readonly appointments = new Map<
    string,
    { userId: string; procedureName: string | null; patientName: string | null }
  >();
  readonly purchaseOrders = new Map<string, string>();
  readonly lots = new Map<string, string>();
  private sequence = 0;

  seedItem(item: Partial<Item> & Pick<Item, 'id' | 'userId'>): Item {
    const full = {
      supplierId: null,
      category: 'MEDICATION',
      unit: 'AMPOULE',
      name: 'Propofol 10mg/ml 20ml',
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

  seedSupplier(id: string, userId: string) {
    this.suppliers.set(id, userId);
  }

  seedAppointment(
    id: string,
    userId: string,
    procedureName: string | null = 'Orquiectomia',
    patientName: string | null = 'Mel',
  ) {
    this.appointments.set(id, { userId, procedureName, patientName });
  }

  seedPurchaseOrder(id: string, userId: string) {
    this.purchaseOrders.set(id, userId);
  }

  seedLot(id: string, itemId: string) {
    this.lots.set(id, itemId);
  }

  findItemById(userId: string, itemId: string): Promise<Item | null> {
    const item = this.items.get(itemId);
    return Promise.resolve(
      item && item.userId === userId && !item.deletedAt ? item : null,
    );
  }

  withLockedItems<T>(
    itemIds: readonly string[],
    fn: (tx: unknown, lockedItems: Map<string, Item>) => Promise<T>,
  ): Promise<T> {
    const locked = new Map<string, Item>();
    for (const id of new Set(itemIds)) {
      const item = this.items.get(id);
      if (item) locked.set(id, item);
    }
    // A transaction: a rejection undoes every write the callback made.
    const ledgerLength = this.movements.length;
    const itemsBefore = new Map(
      [...this.items].map(([id, item]) => [id, { ...item }]),
    );
    return fn(undefined, locked).catch((error: unknown) => {
      this.movements.length = ledgerLength;
      for (const [id, item] of itemsBefore) this.items.set(id, item);
      throw error;
    });
  }

  balanceOf(userId: string, itemId: string): Promise<Prisma.Decimal> {
    const balance = this.movements
      .filter(m => m.userId === userId && m.itemId === itemId && !m.deletedAt)
      .reduce(
        (total, m) =>
          m.type === StockMovementType.INBOUND
            ? total.plus(m.quantity)
            : total.minus(m.quantity),
        decimal(0),
      );
    return Promise.resolve(balance);
  }

  findMovementsByItem(
    userId: string,
    itemId: string,
  ): Promise<MovementWithContext[]> {
    return Promise.resolve(
      this.movements.filter(m => m.userId === userId && m.itemId === itemId),
    );
  }

  findHistory(
    where: Prisma.StockMovementWhereInput,
    skip: number,
    take: number,
  ): Promise<MovementWithContext[]> {
    const itemId = where.itemId as string | undefined;
    // Enough of the Prisma filter to make the period tests mean something: a
    // fake that ignored the range would let a broken filter pass.
    const range = where.occurredAt as { gte?: Date; lte?: Date } | undefined;

    const sorted = [...this.movements]
      .filter(m => m.userId === where.userId && !m.deletedAt)
      .filter(m => (itemId ? m.itemId === itemId : true))
      .filter(m => (range?.gte ? m.occurredAt >= range.gte : true))
      .filter(m => (range?.lte ? m.occurredAt <= range.lte : true))
      .sort(
        (a, b) =>
          b.occurredAt.getTime() - a.occurredAt.getTime() ||
          a.id.localeCompare(b.id),
      );
    return Promise.resolve(sorted.slice(skip, skip + take));
  }

  latestInboundOccurredAt(
    userId: string,
    itemId: string,
  ): Promise<Date | null> {
    const inbounds = this.movements
      .filter(
        m =>
          m.userId === userId &&
          m.itemId === itemId &&
          m.type === StockMovementType.INBOUND,
      )
      .map(m => m.occurredAt.getTime());
    return Promise.resolve(
      inbounds.length > 0 ? new Date(Math.max(...inbounds)) : null,
    );
  }

  findOwnersOfIds(
    ids: readonly string[],
  ): Promise<{ id: string; userId: string }[]> {
    return Promise.resolve(
      this.movements
        .filter(m => ids.includes(m.id))
        .map(m => ({ id: m.id, userId: m.userId })),
    );
  }

  findCreatedAfter(
    userId: string,
    since: Date,
    take: number,
  ): Promise<MovementWithContext[]> {
    return Promise.resolve(
      this.movements
        .filter(m => m.userId === userId && m.createdAt > since)
        .sort(
          (a, b) =>
            a.createdAt.getTime() - b.createdAt.getTime() ||
            a.id.localeCompare(b.id),
        )
        .slice(0, take),
    );
  }

  findItemBalances(userId: string, itemIds: readonly string[]) {
    return Promise.resolve(
      [...this.items.values()]
        .filter(i => i.userId === userId && itemIds.includes(i.id))
        .map(i => ({
          id: i.id,
          name: i.name,
          currentQuantity: i.currentQuantity,
          needsAdjustment: i.needsAdjustment,
        })),
    );
  }

  supplierExists(userId: string, supplierId: string): Promise<boolean> {
    return Promise.resolve(this.suppliers.get(supplierId) === userId);
  }

  appointmentExists(userId: string, appointmentId: string): Promise<boolean> {
    return Promise.resolve(
      this.appointments.get(appointmentId)?.userId === userId,
    );
  }

  purchaseOrderExists(userId: string, orderId: string): Promise<boolean> {
    return Promise.resolve(this.purchaseOrders.get(orderId) === userId);
  }

  lotBelongsToItem(itemId: string, lotId: string): Promise<boolean> {
    return Promise.resolve(this.lots.get(lotId) === itemId);
  }

  create(
    data: Prisma.StockMovementUncheckedCreateInput,
  ): Promise<MovementWithContext> {
    const item = this.items.get(data.itemId)!;
    const appointment = data.appointmentId
      ? this.appointments.get(data.appointmentId)
      : undefined;

    const movement = {
      id: data.id ?? `mov-${++this.sequence}`,
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
      item: { id: item.id, name: item.name, unit: item.unit },
      appointment:
        appointment && data.appointmentId
          ? {
              id: data.appointmentId,
              procedureName: appointment.procedureName,
              patientName: appointment.patientName,
            }
          : null,
    } as unknown as MovementWithContext;

    this.movements.push(movement);
    return Promise.resolve(movement);
  }

  updateItem(
    itemId: string,
    data: Prisma.ItemUncheckedUpdateInput,
  ): Promise<Item> {
    const item = { ...this.items.get(itemId)!, ...data } as Item;
    this.items.set(itemId, item);
    return Promise.resolve(item);
  }
}

const build = () => {
  const repository = new FakeRepository();
  const service = new StockMovementsService(
    repository as unknown as StockMovementsRepository,
  );
  return { repository, service };
};

/** The local user id the guard resolves from the token (`user.id`). */
const ana = 'user-ana';
const bob = 'user-bob';

const adjustmentDto = (
  over: Partial<CreateStockAdjustmentDto> = {},
): CreateStockAdjustmentDto => ({
  itemId: 'item-1',
  quantity: 3,
  reason: AdjustmentReason.LOSS,
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

function inbound(
  itemId: string,
  quantity: number,
  over: Partial<RecordMovementInput> = {},
): RecordMovementInput {
  return {
    itemId,
    type: StockMovementType.INBOUND,
    source: StockMovementSource.MANUAL_PURCHASE,
    quantity,
    unitCost: 10,
    occurredAt: new Date(),
    ...over,
  };
}

function outbound(
  itemId: string,
  quantity: number,
  over: Partial<RecordMovementInput> = {},
): RecordMovementInput {
  return {
    itemId,
    type: StockMovementType.OUTBOUND,
    source: StockMovementSource.APPOINTMENT,
    appointmentId: 'appointment-1',
    quantity,
    unitCost: 10,
    occurredAt: new Date(),
    ...over,
  };
}

describe('StockMovementsService.registerAdjustment (US11)', () => {
  it('records an OUTBOUND MANUAL_ADJUSTMENT that reduces the balance', async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: ana });
    await service.record(ana, inbound('item-1', 10));

    const result = await service.registerAdjustment(
      ana,
      adjustmentDto({ quantity: 4 }),
    );

    expect(result.movement.type).toBe(StockMovementType.OUTBOUND);
    expect(result.movement.source).toBe(StockMovementSource.MANUAL_ADJUSTMENT);
    expect(result.movement.adjustmentReason).toBe(AdjustmentReason.LOSS);
    expect(result.balance).toBe('6');
    expect(repository.items.get('item-1')!.currentQuantity.toNumber()).toBe(6);
  });

  it('prices the movement with the item current unit cost', async () => {
    const { repository, service } = build();
    repository.seedItem({
      id: 'item-1',
      userId: ana,
      defaultUnitCost: decimal('12.5000'),
    });
    await service.record(ana, inbound('item-1', 10));

    const result = await service.registerAdjustment(ana, adjustmentDto());

    expect(result.movement.unitCost).toBe('12.5');
  });

  it('dates the movement with the server clock, not the client', async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: ana });
    await service.record(ana, inbound('item-1', 10));

    const before = Date.now();
    const result = await service.registerAdjustment(ana, adjustmentDto());

    expect(result.movement.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.movement.occurredAt.getTime()).toBeLessThanOrEqual(
      Date.now(),
    );
  });

  it('answers INSUFFICIENT_STOCK with the balance still available', async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: ana });
    await service.record(ana, inbound('item-1', 3));

    const rejected = service.registerAdjustment(
      ana,
      adjustmentDto({ quantity: 5 }),
    );

    await expect(rejected).rejects.toBeInstanceOf(DomainError);
    await expect(rejected).rejects.toMatchObject({
      kind: 'CONFLICT',
      code: 'INSUFFICIENT_STOCK',
      // The app interpolates this number into the message it shows.
      details: { available: '3', requested: '5' },
    });
    expect(repository.movements).toHaveLength(1);
  });

  it('reports nothing available when the balance is already negative', async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: ana });
    await service.record(
      ana,
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

    await expect(
      service.registerAdjustment(ana, adjustmentDto({ quantity: 1 })),
    ).rejects.toMatchObject({ details: { available: '0' } });
  });

  it('requires a note when the reason is OTHER', async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: ana });
    await service.record(ana, inbound('item-1', 10));

    await expect(
      service.registerAdjustment(
        ana,
        adjustmentDto({ reason: AdjustmentReason.OTHER, notes: null }),
      ),
    ).rejects.toMatchObject({ code: 'STOCK_REASON_ADJUSTMENT_INVALID' });

    const accepted = await service.registerAdjustment(
      ana,
      adjustmentDto({
        reason: AdjustmentReason.OTHER,
        notes: 'found spoiled in the back',
      }),
    );
    expect(accepted.movement.notes).toBe('found spoiled in the back');
  });

  it("does not let a user adjust another user's item (ADR-11)", async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: bob });
    await service.record(bob, inbound('item-1', 10));

    await expect(
      service.registerAdjustment(ana, adjustmentDto()),
    ).rejects.toMatchObject({ kind: 'NOT_FOUND', code: 'ITEM_NOT_FOUND' });
  });

  it('flags belowMinimum when the adjustment crosses the item minimum', async () => {
    const { repository, service } = build();
    repository.seedItem({
      id: 'item-1',
      userId: ana,
      minimumStock: decimal(5),
    });
    await service.record(ana, inbound('item-1', 8));

    const result = await service.registerAdjustment(
      ana,
      adjustmentDto({ quantity: 4 }),
    );

    expect(result.balance).toBe('4');
    expect(result.belowMinimum).toBe(true);
  });
});

describe('StockMovementsService.registerCount (US10 — closes needsAdjustment)', () => {
  /** The US10 scenario end to end: reversal digs a hole, the count fills it. */
  const dugIntoTheRed = async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: ana });
    await service.record(ana, inbound('item-1', 2));
    await service.record(
      ana,
      {
        itemId: 'item-1',
        type: StockMovementType.OUTBOUND,
        source: StockMovementSource.CORRECTION_REVERSAL,
        quantity: 5,
        unitCost: 10,
        occurredAt: new Date(),
      },
      { allowNegativeBalance: true },
    );
    return { repository, service };
  };

  it('an authorized reversal into the red flags the item and returns the alert', async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: ana });

    const result = await service.record(
      ana,
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

    expect(result.needsAdjustment).toBe(true);
    expect(result.balance.toNumber()).toBe(-2);
    expect(repository.items.get('item-1')!.needsAdjustment).toBe(true);
  });

  it('writes the difference as an INBOUND and clears the flag', async () => {
    const { repository, service } = await dugIntoTheRed();
    expect(repository.items.get('item-1')!.needsAdjustment).toBe(true);

    const result = await service.registerCount(ana, {
      itemId: 'item-1',
      countedQuantity: 4,
    });

    // The balance was -3 and the shelf says 4: the ledger gets one more
    // movement of +7. Nothing is edited, so the hole stays visible in the
    // history — which is the whole point of an append-only ledger.
    expect(result.movement.type).toBe(StockMovementType.INBOUND);
    expect(result.movement.quantity).toBe('7');
    expect(result.balance).toBe('4');
    expect(result.needsAdjustment).toBe(false);
    expect(repository.items.get('item-1')!.needsAdjustment).toBe(false);
  });

  it('writes an OUTBOUND when the shelf holds less than the ledger says', async () => {
    const { service, repository } = build();
    repository.seedItem({ id: 'item-1', userId: ana });
    await service.record(ana, inbound('item-1', 10));

    const result = await service.registerCount(ana, {
      itemId: 'item-1',
      countedQuantity: 6,
    });

    expect(result.movement.type).toBe(StockMovementType.OUTBOUND);
    expect(result.movement.quantity).toBe('4');
    expect(result.balance).toBe('6');
  });

  it('a count of zero is a valid count', async () => {
    const { service, repository } = build();
    repository.seedItem({ id: 'item-1', userId: ana });
    await service.record(ana, inbound('item-1', 3));

    const result = await service.registerCount(ana, {
      itemId: 'item-1',
      countedQuantity: 0,
    });

    expect(result.balance).toBe('0');
    expect(result.movement.type).toBe(StockMovementType.OUTBOUND);
  });

  it('refuses a count that matches the balance — there is nothing to write', async () => {
    const { service, repository } = build();
    repository.seedItem({ id: 'item-1', userId: ana });
    await service.record(ana, inbound('item-1', 5));

    await expect(
      service.registerCount(ana, { itemId: 'item-1', countedQuantity: 5 }),
    ).rejects.toMatchObject({ code: 'STOCK_QUANTITY_INVALID' });
  });

  it('an ordinary movement never clears the flag on its own', async () => {
    const { repository, service } = await dugIntoTheRed();

    await service.registerPurchase(ana, purchaseDto({ quantity: 50 }));

    // Back in the black, still flagged: only a count answers the question.
    expect(repository.items.get('item-1')!.currentQuantity.toNumber()).toBe(47);
    expect(repository.items.get('item-1')!.needsAdjustment).toBe(true);
  });
});

describe('StockMovementsService.registerPurchase (manual purchase entry)', () => {
  it('records an INBOUND MANUAL_PURCHASE that adds to the balance', async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: ana });

    const result = await service.registerPurchase(
      ana,
      purchaseDto({ quantity: 7 }),
    );

    expect(result.movement.type).toBe(StockMovementType.INBOUND);
    expect(result.movement.source).toBe(StockMovementSource.MANUAL_PURCHASE);
    expect(repository.items.get('item-1')!.currentQuantity.toNumber()).toBe(7);
  });

  it('updates the item unit cost to the price paid (US10 rule)', async () => {
    const { repository, service } = build();
    repository.seedItem({
      id: 'item-1',
      userId: ana,
      defaultUnitCost: decimal(10),
    });

    const result = await service.registerPurchase(
      ana,
      purchaseDto({ unitValue: 13.5 }),
    );

    expect(result.movement.unitCost).toBe('13.5');
    expect(repository.items.get('item-1')!.defaultUnitCost!.toNumber()).toBe(
      13.5,
    );
  });

  it('does not let a backdated purchase overwrite a newer price', async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: ana });

    await service.registerPurchase(
      ana,
      purchaseDto({ unitValue: 20, date: '2026-09-01T00:00:00.000Z' }),
    );
    await service.registerPurchase(
      ana,
      purchaseDto({ unitValue: 9, date: '2026-08-01T00:00:00.000Z' }),
    );

    expect(repository.items.get('item-1')!.defaultUnitCost!.toNumber()).toBe(
      20,
    );
  });

  it('accepts an optional supplier that belongs to the user', async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: ana });
    repository.seedSupplier('sup-1', ana);

    const result = await service.registerPurchase(
      ana,
      purchaseDto({ supplierId: 'sup-1' }),
    );

    expect(result.movement.supplierId).toBe('sup-1');
  });

  it("rejects another user's supplier without writing anything", async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: ana });
    repository.seedSupplier('sup-bob', bob);

    await expect(
      service.registerPurchase(ana, purchaseDto({ supplierId: 'sup-bob' })),
    ).rejects.toMatchObject({
      kind: 'INVALID_REFERENCE',
      code: 'SUPPLIER_NOT_FOUND',
    });
    expect(repository.movements).toHaveLength(0);
  });

  it('rejects a future date but accepts a backdated one', async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: ana });

    await expect(
      service.registerPurchase(ana, purchaseDto({ date: '2099-01-01' })),
    ).rejects.toMatchObject({ code: 'STOCK_MOVEMENT_DATE_IN_FUTURE' });

    const backdated = await service.registerPurchase(
      ana,
      purchaseDto({ date: '2020-01-01' }),
    );
    expect(backdated.movement.occurredAt).toEqual(new Date('2020-01-01'));
  });

  it('reactivates an inactive item', async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: ana, active: false });

    await service.registerPurchase(ana, purchaseDto());

    expect(repository.items.get('item-1')!.active).toBe(true);
  });
});

describe('StockMovementsService.recordBatch (US06 / US10 — several items at once)', () => {
  const twoItems = () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: ana, name: 'Propofol' });
    repository.seedItem({ id: 'item-2', userId: ana, name: 'Midazolam' });
    repository.seedAppointment('appointment-1', ana);
    return { repository, service };
  };

  it('records every movement and updates every item', async () => {
    const { repository, service } = twoItems();
    await service.recordBatch(ana, [
      inbound('item-1', 10),
      inbound('item-2', 4),
    ]);

    const results = await service.recordBatch(ana, [
      outbound('item-1', 2),
      outbound('item-2', 1),
    ]);

    expect(results).toHaveLength(2);
    expect(repository.items.get('item-1')!.currentQuantity.toNumber()).toBe(8);
    expect(repository.items.get('item-2')!.currentQuantity.toNumber()).toBe(3);
  });

  it('carries the balance forward between movements of the same item', async () => {
    const { repository, service } = twoItems();
    await service.record(ana, inbound('item-1', 5));

    const results = await service.recordBatch(ana, [
      outbound('item-1', 3),
      outbound('item-1', 2),
    ]);

    expect(results.map(r => r.balance.toNumber())).toEqual([2, 0]);
    expect(repository.items.get('item-1')!.currentQuantity.toNumber()).toBe(0);
  });

  it('leaves no partial effect when one movement in the batch fails', async () => {
    const { repository, service } = twoItems();
    await service.recordBatch(ana, [
      inbound('item-1', 10),
      inbound('item-2', 1),
    ]);
    const ledgerBefore = repository.movements.length;

    // The third line asks for more than item-2 has: the whole batch is refused.
    await expect(
      service.recordBatch(ana, [
        outbound('item-1', 1),
        outbound('item-1', 1),
        outbound('item-2', 99),
      ]),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });

    expect(repository.movements).toHaveLength(ledgerBefore);
    expect(repository.items.get('item-1')!.currentQuantity.toNumber()).toBe(10);
    expect(repository.items.get('item-2')!.currentQuantity.toNumber()).toBe(1);
  });

  it('refuses the batch when any item belongs to someone else (ADR-11)', async () => {
    const { repository, service } = twoItems();
    repository.seedItem({ id: 'item-bob', userId: bob });
    await service.record(ana, inbound('item-1', 10));
    const ledgerBefore = repository.movements.length;

    await expect(
      service.recordBatch(ana, [inbound('item-1', 1), inbound('item-bob', 1)]),
    ).rejects.toMatchObject({ code: 'ITEM_NOT_FOUND' });

    expect(repository.movements).toHaveLength(ledgerBefore);
  });

  it('keeps the flag when a batch dips into the red and climbs back out', async () => {
    const { repository, service } = twoItems();

    const results = await service.recordBatch(
      ana,
      [
        {
          itemId: 'item-1',
          type: StockMovementType.OUTBOUND,
          source: StockMovementSource.CORRECTION_REVERSAL,
          quantity: 5,
          unitCost: 10,
          occurredAt: new Date(),
        },
        inbound('item-1', 12),
      ],
      { allowNegativeBalance: true },
    );

    // The balance ends at +7, but the batch did go negative on the way — the
    // alert each movement reports must match what the row ends up holding.
    expect(results.map(r => r.needsAdjustment)).toEqual([true, true]);
    expect(repository.items.get('item-1')!.needsAdjustment).toBe(true);
    expect(repository.items.get('item-1')!.currentQuantity.toNumber()).toBe(7);
  });

  it('refuses an empty batch rather than silently doing nothing', async () => {
    const { service } = build();
    await expect(service.recordBatch(ana, [])).rejects.toMatchObject({
      code: 'STOCK_MOVEMENT_BATCH_EMPTY',
    });
  });
});

describe('StockMovementsService.record — reference ownership (ADR-11)', () => {
  const seeded = () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: ana });
    repository.seedAppointment('appointment-1', ana);
    repository.seedPurchaseOrder('order-1', ana);
    return { repository, service };
  };

  it("refuses another user's appointment", async () => {
    const { repository, service } = seeded();
    repository.seedAppointment('appointment-bob', bob);
    await service.record(ana, inbound('item-1', 10));

    await expect(
      service.record(
        ana,
        outbound('item-1', 1, { appointmentId: 'appointment-bob' }),
      ),
    ).rejects.toMatchObject({
      kind: 'INVALID_REFERENCE',
      code: 'APPOINTMENT_NOT_FOUND',
    });
  });

  it("refuses another user's purchase order", async () => {
    const { repository, service } = seeded();
    repository.seedPurchaseOrder('order-bob', bob);

    await expect(
      service.record(
        ana,
        inbound('item-1', 1, {
          source: StockMovementSource.ORDER_IMPORT,
          purchaseOrderId: 'order-bob',
        }),
      ),
    ).rejects.toMatchObject({ code: 'PURCHASE_ORDER_NOT_FOUND' });
  });

  it('refuses a lot that belongs to a different item', async () => {
    const { repository, service } = seeded();
    repository.seedItem({ id: 'item-2', userId: ana });
    repository.seedLot('lot-of-item-2', 'item-2');

    await expect(
      service.record(ana, inbound('item-1', 1, { lotId: 'lot-of-item-2' })),
    ).rejects.toMatchObject({ code: 'ITEM_LOT_NOT_FOUND' });
  });

  it('accepts references that belong to the user', async () => {
    const { service } = seeded();
    await service.record(ana, inbound('item-1', 10));

    const result = await service.record(ana, outbound('item-1', 2));

    expect(result.movement.appointmentId).toBe('appointment-1');
    expect(result.movement.appointment).toEqual({
      id: 'appointment-1',
      procedureName: 'Orquiectomia',
      patientName: 'Mel',
    });
  });
});

describe('StockMovementsService.findHistory', () => {
  it('returns the movement with the item context the app lists', async () => {
    const { repository, service } = build();
    repository.seedItem({
      id: 'item-1',
      userId: ana,
      name: 'Propofol 10mg/ml 20ml',
      unit: 'AMPOULE',
    });
    repository.seedAppointment('appointment-1', ana, 'Orquiectomia', 'Mel');
    // Explicit instants: the order of the list is the contract being tested,
    // and two `new Date()` a millisecond apart would decide it by accident.
    await service.record(
      ana,
      inbound('item-1', 10, { occurredAt: new Date('2026-09-01T10:00:00Z') }),
    );
    await service.record(
      ana,
      outbound('item-1', 2, {
        unitCost: 19.9,
        occurredAt: new Date('2026-09-08T09:30:00Z'),
      }),
    );

    const [newest] = await service.findHistory(
      ana,
      plainToInstance(QueryStockMovementDto, { itemId: 'item-1' }),
    );

    expect(newest).toMatchObject({
      itemName: 'Propofol 10mg/ml 20ml',
      unit: 'AMPOULE',
      type: StockMovementType.OUTBOUND,
      source: StockMovementSource.APPOINTMENT,
      // Positive magnitude and a per-unit cost: the app derives the sign from
      // `type` and multiplies to get the line total.
      quantity: '2',
      unitCost: '19.9',
    });
    expect(newest.appointment).toEqual({
      id: 'appointment-1',
      label: 'Orquiectomia — Mel',
      procedureName: 'Orquiectomia',
      patientName: 'Mel',
    });
  });

  it('labels an appointment that has only one of the two fields', async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: ana });
    repository.seedAppointment('appointment-1', ana, null, 'Mel');
    await service.record(
      ana,
      inbound('item-1', 10, { occurredAt: new Date('2026-09-01T10:00:00Z') }),
    );
    await service.record(
      ana,
      outbound('item-1', 1, { occurredAt: new Date('2026-09-08T10:00:00Z') }),
    );

    const [newest] = await service.findHistory(
      ana,
      plainToInstance(QueryStockMovementDto, {}),
    );

    expect(newest.appointment!.label).toBe('Mel');
  });

  it('filters by period, isolated and combined with the item filter', async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: ana });
    repository.seedItem({ id: 'item-2', userId: ana, name: 'Isoflurano' });
    await service.record(
      ana,
      inbound('item-1', 5, { occurredAt: new Date('2026-08-20T10:00:00Z') }),
    );
    await service.record(
      ana,
      inbound('item-1', 5, { occurredAt: new Date('2026-09-03T10:00:00Z') }),
    );
    await service.record(
      ana,
      inbound('item-2', 5, { occurredAt: new Date('2026-09-04T10:00:00Z') }),
    );

    const period = { periodStart: '2026-09-01', periodEnd: '2026-09-05' };

    const byPeriod = await service.findHistory(
      ana,
      plainToInstance(QueryStockMovementDto, period),
    );
    expect(byPeriod).toHaveLength(2);

    const byItem = await service.findHistory(
      ana,
      plainToInstance(QueryStockMovementDto, { itemId: 'item-1' }),
    );
    expect(byItem).toHaveLength(2);

    const combined = await service.findHistory(
      ana,
      plainToInstance(QueryStockMovementDto, { ...period, itemId: 'item-1' }),
    );
    expect(combined).toHaveLength(1);
    expect(combined[0].occurredAt).toEqual(new Date('2026-09-03T10:00:00Z'));
  });

  it('includes the whole last day of the period, not just its midnight', async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: ana });
    await service.record(
      ana,
      inbound('item-1', 1, { occurredAt: new Date('2026-09-05T23:30:00Z') }),
    );

    const found = await service.findHistory(
      ana,
      plainToInstance(QueryStockMovementDto, {
        periodStart: '2026-09-01',
        periodEnd: '2026-09-05',
      }),
    );

    expect(found).toHaveLength(1);
  });

  it('leaves appointment null on every other origin', async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: ana });
    await service.record(ana, inbound('item-1', 10));

    const [movement] = await service.findHistory(
      ana,
      plainToInstance(QueryStockMovementDto, {}),
    );

    expect(movement.appointment).toBeNull();
    expect(movement.appointmentId).toBeNull();
  });
});

describe('StockMovementsService.syncPush (offline sync)', () => {
  const at = (iso: string) => new Date(iso);

  /** A movement as a device records it: its own UUID, its own clock. */
  const offline = (
    id: string,
    quantity: number,
    occurredAt: string,
    over: Partial<RecordMovementInput> = {},
  ) => ({
    id,
    itemId: 'item-1',
    type: StockMovementType.OUTBOUND,
    source: StockMovementSource.MANUAL_ADJUSTMENT,
    adjustmentReason: AdjustmentReason.LOSS,
    quantity,
    unitCost: 10,
    occurredAt: at(occurredAt),
    ...over,
  });

  const stocked = async (quantity = 20) => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: ana });
    await service.record(ana, inbound('item-1', quantity));
    return { repository, service };
  };

  it('applies what was recorded offline, with the right balance', async () => {
    const { repository, service } = await stocked();

    const result = await service.syncPush(ana, [
      offline(
        '11111111-1111-4111-8111-111111111111',
        3,
        '2026-09-10T08:00:00Z',
      ),
      offline(
        '22222222-2222-4222-8222-222222222222',
        2,
        '2026-09-10T09:00:00Z',
      ),
    ]);

    expect(result.applied).toHaveLength(2);
    expect(result.duplicated).toEqual([]);
    expect(repository.items.get('item-1')!.currentQuantity.toNumber()).toBe(15);
    expect(result.balances).toEqual([
      expect.objectContaining({ itemId: 'item-1', currentQuantity: '15' }),
    ]);
  });

  it('re-sending the same batch does not move the balance again', async () => {
    const { repository, service } = await stocked();
    const batch = [
      offline(
        '11111111-1111-4111-8111-111111111111',
        3,
        '2026-09-10T08:00:00Z',
      ),
      offline(
        '22222222-2222-4222-8222-222222222222',
        2,
        '2026-09-10T09:00:00Z',
      ),
    ];

    await service.syncPush(ana, batch);
    const afterFirst = repository.items
      .get('item-1')!
      .currentQuantity.toNumber();

    // The network dropped before the device saw the answer, so it sends again.
    const retry = await service.syncPush(ana, batch);

    expect(retry.applied).toEqual([]);
    expect(retry.duplicated).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]);
    expect(repository.items.get('item-1')!.currentQuantity.toNumber()).toBe(
      afterFirst,
    );
  });

  it('applies only the movements a partial delivery left behind', async () => {
    const { repository, service } = await stocked();
    const first = offline(
      '11111111-1111-4111-8111-111111111111',
      3,
      '2026-09-10T08:00:00Z',
    );
    await service.syncPush(ana, [first]);

    const result = await service.syncPush(ana, [
      first,
      offline(
        '22222222-2222-4222-8222-222222222222',
        2,
        '2026-09-10T09:00:00Z',
      ),
    ]);

    expect(result.duplicated).toEqual(['11111111-1111-4111-8111-111111111111']);
    expect(result.applied).toHaveLength(1);
    expect(repository.items.get('item-1')!.currentQuantity.toNumber()).toBe(15);
  });

  it('applies in chronological order, not in arrival order', async () => {
    const { service } = await stocked();

    const result = await service.syncPush(ana, [
      offline(
        '33333333-3333-4333-8333-333333333333',
        1,
        '2026-09-12T10:00:00Z',
      ),
      offline(
        '11111111-1111-4111-8111-111111111111',
        1,
        '2026-09-10T10:00:00Z',
      ),
      offline(
        '22222222-2222-4222-8222-222222222222',
        1,
        '2026-09-11T10:00:00Z',
      ),
    ]);

    expect(result.applied.map(m => m.occurredAt)).toEqual([
      at('2026-09-10T10:00:00Z'),
      at('2026-09-11T10:00:00Z'),
      at('2026-09-12T10:00:00Z'),
    ]);
  });

  it('keeps an offline consumption that another device already used up', async () => {
    const { repository, service } = await stocked(2);

    // The other device took the last two units while this one was offline.
    await service.registerAdjustment(ana, adjustmentDto({ quantity: 2 }));

    const result = await service.syncPush(ana, [
      offline(
        '11111111-1111-4111-8111-111111111111',
        2,
        '2026-09-10T08:00:00Z',
      ),
    ]);

    // The stock really did leave the shelf: recorded, flagged, not discarded.
    expect(result.applied).toHaveLength(1);
    expect(result.needsAdjustment).toEqual(['item-1']);
    expect(repository.items.get('item-1')!.currentQuantity.toNumber()).toBe(-2);
    expect(repository.items.get('item-1')!.needsAdjustment).toBe(true);
  });

  it('adds up movements coming from two devices', async () => {
    const { repository, service } = await stocked();

    await service.syncPush(ana, [
      offline(
        '11111111-1111-4111-8111-111111111111',
        4,
        '2026-09-10T08:00:00Z',
      ),
    ]);
    await service.syncPush(ana, [
      offline(
        '22222222-2222-4222-8222-222222222222',
        6,
        '2026-09-10T07:00:00Z',
      ),
    ]);

    expect(repository.items.get('item-1')!.currentQuantity.toNumber()).toBe(10);
    expect(repository.movements).toHaveLength(3);
  });

  it('refuses an id that belongs to another account instead of dropping it', async () => {
    const { repository, service } = await stocked();
    repository.seedItem({ id: 'item-bob', userId: bob });
    await service.record(bob, {
      ...inbound('item-bob', 5),
      id: '11111111-1111-4111-8111-111111111111',
    });

    await expect(
      service.syncPush(ana, [
        offline(
          '11111111-1111-4111-8111-111111111111',
          1,
          '2026-09-10T08:00:00Z',
        ),
      ]),
    ).rejects.toMatchObject({
      kind: 'CONFLICT',
      code: 'STOCK_MOVEMENT_ID_CONFLICT',
    });
  });

  it('fails the whole batch when the item was never synced (items come first)', async () => {
    const { repository, service } = await stocked();
    const ledgerBefore = repository.movements.length;

    await expect(
      service.syncPush(ana, [
        offline(
          '11111111-1111-4111-8111-111111111111',
          1,
          '2026-09-10T08:00:00Z',
        ),
        offline(
          '22222222-2222-4222-8222-222222222222',
          1,
          '2026-09-10T09:00:00Z',
          {
            itemId: 'item-created-offline',
          },
        ),
      ]),
    ).rejects.toMatchObject({ code: 'ITEM_NOT_FOUND' });

    expect(repository.movements).toHaveLength(ledgerBefore);
  });

  it('refuses an empty batch', async () => {
    const { service } = build();
    await expect(service.syncPush(ana, [])).rejects.toMatchObject({
      code: 'STOCK_MOVEMENT_BATCH_EMPTY',
    });
  });
});

describe('StockMovementsService.syncPull (delta)', () => {
  it('returns what was written after the cursor, with the balances', async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: ana });
    await service.record(ana, inbound('item-1', 10));
    // Older than the overlap window, so it is genuinely behind the cursor.
    repository.movements[0].createdAt = new Date(Date.now() - 3_600_000);

    const cursor = new Date();
    await service.registerAdjustment(ana, adjustmentDto({ quantity: 4 }));

    const delta = await service.syncPull(ana, cursor);

    expect(delta.movements).toHaveLength(1);
    expect(delta.movements[0].type).toBe(StockMovementType.OUTBOUND);
    expect(delta.balances).toEqual([
      expect.objectContaining({ itemId: 'item-1', currentQuantity: '6' }),
    ]);
  });

  it('moves the cursor forward to the newest row it handed out', async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: ana });
    await service.record(ana, inbound('item-1', 10));

    const delta = await service.syncPull(ana, new Date(Date.now() - 60_000));

    expect(delta.cursor).toEqual(repository.movements.at(-1)!.createdAt);
  });

  it('rewinds the cursor so a late commit is re-sent rather than skipped', async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: ana });
    await service.record(ana, inbound('item-1', 10));

    // ADR-08: the overlap window means a movement written just before the
    // device's cursor still comes back. Applying it twice is a no-op, missing
    // it forever is not.
    const delta = await service.syncPull(ana, new Date(Date.now() + 1000));

    expect(delta.movements).toHaveLength(1);
  });

  it('keeps the given cursor when nothing changed', async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: ana });
    const cursor = new Date(Date.now() + 60_000);

    const delta = await service.syncPull(ana, cursor);

    expect(delta.movements).toEqual([]);
    expect(delta.balances).toEqual([]);
    expect(delta.cursor).toEqual(cursor);
  });

  it("never leaks another account's movements (ADR-11)", async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-bob', userId: bob });
    await service.record(bob, inbound('item-bob', 10));

    const delta = await service.syncPull(ana, new Date(Date.now() - 60_000));

    expect(delta.movements).toEqual([]);
  });
});

describe('StockMovementsService.reconcileItemBalance (support routine)', () => {
  it('reports no divergence when the cache already matches the ledger', async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: ana });
    await service.record(ana, inbound('item-1', 10));

    const result = await service.reconcileItemBalance(ana, 'item-1');

    expect(result.wasDivergent).toBe(false);
    expect(result.reconciledBalance).toBe('10');
  });

  it('corrects the cache when it drifted from the ledger', async () => {
    const { repository, service } = build();
    repository.seedItem({ id: 'item-1', userId: ana });
    await service.record(ana, inbound('item-1', 10));

    // simulates external drift: someone touched currentQuantity outside record()
    repository.items.get('item-1')!.currentQuantity = decimal(999);

    const result = await service.reconcileItemBalance(ana, 'item-1');

    expect(result.wasDivergent).toBe(true);
    expect(result.previousBalance).toBe('999');
    expect(result.reconciledBalance).toBe('10');
    expect(repository.items.get('item-1')!.currentQuantity.toNumber()).toBe(10);
  });

  it('throws when the item does not exist for the user', async () => {
    const { service } = build();
    await expect(
      service.reconcileItemBalance(ana, 'missing'),
    ).rejects.toMatchObject({ code: 'ITEM_NOT_FOUND' });
  });
});

describe('CreateStockAdjustmentDto', () => {
  const parse = (raw: unknown) =>
    validate(plainToInstance(CreateStockAdjustmentDto, raw));

  const valid = {
    itemId: '11111111-1111-4111-8111-111111111111',
    quantity: 2,
    reason: 'LOSS',
  };

  it('accepts exactly what the app sends, reason in lower case included', async () => {
    const errors = await parse({
      itemId: valid.itemId,
      quantity: 2,
      reason: 'breakage',
      notes: null,
    });
    expect(errors).toHaveLength(0);
  });

  it('normalizes the reason to the enum spelling', () => {
    const dto = plainToInstance(CreateStockAdjustmentDto, {
      ...valid,
      reason: 'expiration',
    });
    expect(dto.reason).toBe(AdjustmentReason.EXPIRATION);
  });

  it('rejects a missing or unknown reason', async () => {
    const missing = await parse({ ...valid, reason: undefined });
    expect(missing.some(e => e.property === 'reason')).toBe(true);

    const unknown = await parse({ ...valid, reason: 'stolen' });
    expect(unknown.some(e => e.property === 'reason')).toBe(true);
  });

  it('rejects a non-positive quantity', async () => {
    const errors = await parse({ ...valid, quantity: 0 });
    expect(errors.some(e => e.property === 'quantity')).toBe(true);
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

  it('rejects a supplierId that is not a uuid', async () => {
    const errors = await parse({ ...valid, supplierId: 'not-a-uuid' });
    expect(errors.some(e => e.property === 'supplierId')).toBe(true);
  });
});

describe('QueryStockMovementDto', () => {
  it('defaults to the first page and a limit the app can page through', () => {
    const dto = plainToInstance(QueryStockMovementDto, {});
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(50);
  });

  it('rejects a limit above the cap instead of silently truncating', async () => {
    const errors = await validate(
      plainToInstance(QueryStockMovementDto, { limit: 500 }),
    );
    expect(errors.some(e => e.property === 'limit')).toBe(true);
  });

  it('accepts the origin filter in either case', () => {
    const dto = plainToInstance(QueryStockMovementDto, {
      source: 'manualAdjustment',
    });
    expect(dto.source).toEqual([StockMovementSource.MANUAL_ADJUSTMENT]);
  });

  it('filters by period with the names the rest of the project already uses', () => {
    // `periodStart`/`periodEnd` come from the Report model, `search`/`page`/
    // `limit` from the item and supplier listings, `itemId` from every route
    // that takes one. Renaming any of them is an API break, not a tidy-up.
    const dto = plainToInstance(QueryStockMovementDto, {
      itemId: '11111111-1111-4111-8111-111111111111',
      search: 'propo',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-05',
      page: 2,
      limit: 25,
    });

    expect(dto).toMatchObject({
      itemId: '11111111-1111-4111-8111-111111111111',
      search: 'propo',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-05',
      page: 2,
      limit: 25,
    });
  });
});
