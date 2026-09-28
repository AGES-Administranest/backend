import {
  Appointment,
  Item,
  ItemLot,
  Prisma,
  StockMovement,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';

import {
  AppointmentsRepository,
  CorrectedItemUsage,
  ItemUsage,
  ItemWithLots,
  RecordedItemUsage,
  SupplyMovement,
} from './appointments.repository';
import { reversalOf } from '../stock-movements';
import { AppointmentsService } from './appointments.service';
import { UniqueConstraintError } from '../../infra/prisma/prisma-errors';
import { DomainError } from '../../shared/errors/domain-error';

const USER_ID = 'user-1';
const OTHER_USER_ID = 'user-2';

function buildAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: randomUUID(),
    userId: USER_ID,
    clientId: null,
    procedureName: 'Consulta de rotina',
    startsAt: new Date('2026-09-25T13:00:00.000Z'),
    endsAt: new Date('2026-09-25T14:00:00.000Z'),
    location: null,
    amount: null,
    patientName: null,
    ownerName: null,
    species: null,
    patientAgeYears: null,
    weightKg: null,
    notes: null,
    status: 'SCHEDULED',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    asa: null,
    clientGeneratedId: null,
    ...overrides,
  };
}

function buildItem(overrides: Partial<Item> = {}): Item {
  return {
    id: randomUUID(),
    userId: USER_ID,
    supplierId: null,
    category: 'MEDICATION',
    unit: 'AMPOULE',
    name: 'Dipirona 500mg',
    defaultUnitCost: null,
    minimumStock: null,
    currentQuantity: new Prisma.Decimal(10),
    needsAdjustment: false,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function buildLot(itemId: string, overrides: Partial<ItemLot> = {}): ItemLot {
  return {
    id: randomUUID(),
    itemId,
    lotNumber: null,
    expirationDate: null,
    unitCost: new Prisma.Decimal('12.5'),
    currentQuantity: new Prisma.Decimal(10),
    receivedOn: new Date('2026-09-01'),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * In-memory stand-in for `AppointmentsRepository`. It replicates the overlap
 * query (`startsAt < endsAt AND endsAt > startsAt`, same user, `SCHEDULED`,
 * not soft-deleted) instead of mocking it, so the tests exercise the actual
 * conflict semantics rather than a canned answer.
 */
class FakeAppointmentsRepository {
  private readonly rows = new Map<string, Appointment>();
  readonly items = new Map<string, ItemWithLots>();
  readonly movements: StockMovement[] = [];
  /** Simulates a concurrent copy of the request: the next replay lookup misses. */
  missNextReplayLookup = false;

  seedItem(item: Item, lots: ItemLot[] = []): ItemWithLots {
    const row = { ...item, lots };
    this.items.set(item.id, row);
    return row;
  }

  findItemsWithLots(
    itemIds: readonly string[],
    userId: string,
  ): Promise<ItemWithLots[]> {
    return Promise.resolve(
      itemIds
        .map(id => this.items.get(id))
        .filter(
          (item): item is ItemWithLots =>
            !!item && item.userId === userId && !item.deletedAt,
        ),
    );
  }

  findMovementsByClientGeneratedIds(
    clientGeneratedIds: readonly string[],
    userId: string,
  ): Promise<StockMovement[]> {
    if (this.missNextReplayLookup) {
      this.missNextReplayLookup = false;
      return Promise.resolve([]);
    }
    return Promise.resolve(
      this.movements.filter(
        movement =>
          movement.userId === userId &&
          movement.clientGeneratedId !== null &&
          clientGeneratedIds.includes(movement.clientGeneratedId),
      ),
    );
  }

  recordItemUsage(
    userId: string,
    appointmentId: string,
    occurredAt: Date,
    usages: readonly ItemUsage[],
  ): Promise<RecordedItemUsage[] | null> {
    // Re-read inside the transaction, as the SELECT ... FOR SHARE does.
    const appointment = this.rows.get(appointmentId);
    if (
      !appointment ||
      appointment.userId !== userId ||
      appointment.deletedAt ||
      appointment.status === 'CANCELED'
    ) {
      return Promise.resolve(null);
    }

    // The (user_id, client_generated_id) unique key rolls the whole
    // transaction back before anything is applied.
    const taken = usages.some(
      usage =>
        usage.clientGeneratedId !== null &&
        this.movements.some(
          movement =>
            movement.userId === userId &&
            movement.clientGeneratedId === usage.clientGeneratedId,
        ),
    );
    if (taken) {
      return Promise.reject(
        new UniqueConstraintError(['userId', 'clientGeneratedId']),
      );
    }

    return Promise.resolve(
      usages.map(usage => {
        const movement: StockMovement = {
          id: randomUUID(),
          userId,
          clientGeneratedId: usage.clientGeneratedId,
          itemId: usage.itemId,
          lotId: usage.lotId,
          type: 'OUTBOUND',
          source: 'APPOINTMENT',
          adjustmentReason: null,
          quantity: usage.quantity,
          unitCost: usage.unitCost,
          occurredAt,
          appointmentId,
          purchaseOrderId: null,
          purchaseInvoiceLineId: null,
          supplierId: null,
          reversedMovementId: null,
          notes: null,
          createdAt: new Date(),
          deletedAt: null,
        };
        this.movements.push(movement);

        const item = this.items.get(usage.itemId)!;
        item.currentQuantity = item.currentQuantity.minus(usage.quantity);
        if (item.currentQuantity.isNegative()) item.needsAdjustment = true;
        const lot = item.lots.find(l => l.id === usage.lotId);
        if (lot)
          lot.currentQuantity = lot.currentQuantity.minus(usage.quantity);

        return { movement, itemBalance: item.currentQuantity };
      }),
    );
  }

  findMovement(id: string, userId: string): Promise<SupplyMovement | null> {
    const movement = this.movements.find(
      row => row.id === id && row.userId === userId && !row.deletedAt,
    );
    if (!movement) return Promise.resolve(null);
    return Promise.resolve({
      ...movement,
      reversal:
        this.movements.find(row => row.reversedMovementId === movement.id) ??
        null,
      item: {
        currentQuantity: this.items.get(movement.itemId)!.currentQuantity,
      },
    });
  }

  correctItemUsage(
    userId: string,
    original: StockMovement,
    replacement: {
      quantity: Prisma.Decimal;
      clientGeneratedId: string | null;
    } | null,
  ): Promise<CorrectedItemUsage | null> {
    const appointment = this.rows.get(original.appointmentId!);
    if (
      !appointment ||
      appointment.userId !== userId ||
      appointment.deletedAt ||
      appointment.status === 'CANCELED'
    ) {
      return Promise.resolve(null);
    }
    // The unique reversed_movement_id / (user_id, client_generated_id) keys
    // roll the whole transaction back.
    const taken =
      this.movements.some(row => row.reversedMovementId === original.id) ||
      (replacement?.clientGeneratedId != null &&
        this.movements.some(
          row => row.clientGeneratedId === replacement.clientGeneratedId,
        ));
    if (taken) {
      return Promise.reject(new UniqueConstraintError(['reversedMovementId']));
    }

    const reversal = this.append(userId, {
      ...reversalOf(original),
      clientGeneratedId: null,
    });
    let itemBalance = this.applyToCaches(reversal);
    let movement: StockMovement | null = null;
    if (replacement) {
      movement = this.append(userId, {
        clientGeneratedId: replacement.clientGeneratedId,
        itemId: original.itemId,
        lotId: original.lotId,
        appointmentId: original.appointmentId,
        type: 'OUTBOUND',
        source: 'APPOINTMENT',
        quantity: replacement.quantity,
        unitCost: original.unitCost,
        occurredAt: original.occurredAt,
        reversedMovementId: null,
        notes: null,
      });
      itemBalance = this.applyToCaches(movement);
    }
    return Promise.resolve({ reversal, movement, itemBalance });
  }

  private append(
    userId: string,
    fields: Pick<
      StockMovement,
      | 'clientGeneratedId'
      | 'itemId'
      | 'lotId'
      | 'appointmentId'
      | 'type'
      | 'source'
      | 'quantity'
      | 'unitCost'
      | 'occurredAt'
      | 'reversedMovementId'
      | 'notes'
    >,
  ): StockMovement {
    const movement: StockMovement = {
      ...fields,
      id: randomUUID(),
      userId,
      adjustmentReason: null,
      purchaseOrderId: null,
      purchaseInvoiceLineId: null,
      supplierId: null,
      createdAt: new Date(),
      deletedAt: null,
    };
    this.movements.push(movement);
    return movement;
  }

  private applyToCaches(movement: StockMovement): Prisma.Decimal {
    const signed =
      movement.type === 'INBOUND'
        ? movement.quantity
        : movement.quantity.negated();
    const item = this.items.get(movement.itemId)!;
    item.currentQuantity = item.currentQuantity.plus(signed);
    if (item.currentQuantity.isNegative()) item.needsAdjustment = true;
    const lot = item.lots.find(l => l.id === movement.lotId);
    if (lot) lot.currentQuantity = lot.currentQuantity.plus(signed);
    return item.currentQuantity;
  }

  seed(appointment: Appointment): void {
    this.rows.set(appointment.id, appointment);
  }

  findById(id: string, userId: string): Promise<Appointment | null> {
    const row = this.rows.get(id);
    return Promise.resolve(
      row && row.userId === userId && !row.deletedAt ? row : null,
    );
  }

  findConflicting(
    userId: string,
    startsAt: Date,
    endsAt: Date,
    excludeId?: string,
  ): Promise<Appointment | null> {
    const match = [...this.rows.values()].find(
      row =>
        row.userId === userId &&
        row.status === 'SCHEDULED' &&
        !row.deletedAt &&
        row.id !== excludeId &&
        row.startsAt < endsAt &&
        row.endsAt !== null &&
        row.endsAt > startsAt,
    );
    return Promise.resolve(match ?? null);
  }

  create(
    data: Partial<Appointment> & { userId: string },
  ): Promise<{ appointment: Appointment; created: boolean }> {
    const appointment = buildAppointment({ ...data, id: randomUUID() });
    this.rows.set(appointment.id, appointment);
    return Promise.resolve({ appointment, created: true });
  }

  update(
    id: string,
    userId: string,
    data: Partial<Appointment>,
  ): Promise<Appointment | null> {
    const row = this.rows.get(id);
    if (!row || row.userId !== userId || row.deletedAt) {
      return Promise.resolve(null);
    }
    const updated = { ...row, ...data };
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }
}

describe('AppointmentsService — detecção de conflito de horário', () => {
  let repository: FakeAppointmentsRepository;
  let service: AppointmentsService;

  beforeEach(() => {
    repository = new FakeAppointmentsRepository();
    service = new AppointmentsService(
      repository as unknown as AppointmentsRepository,
    );
  });

  const createDto = (startsAt: string, endsAt: string) => ({
    startsAt,
    endsAt,
    procedureName: 'Consulta',
  });

  describe('checkConflict', () => {
    it('finds no conflict against an empty schedule', async () => {
      await expect(
        service.checkConflict(
          USER_ID,
          new Date('2026-09-25T13:00:00.000Z'),
          new Date('2026-09-25T14:00:00.000Z'),
        ),
      ).resolves.toEqual({ conflict: false });
    });

    it('flags an overlapping interval and names the appointment it clashes with', async () => {
      const existing = buildAppointment({
        startsAt: new Date('2026-09-25T13:00:00.000Z'),
        endsAt: new Date('2026-09-25T14:00:00.000Z'),
      });
      repository.seed(existing);

      const result = await service.checkConflict(
        USER_ID,
        new Date('2026-09-25T13:30:00.000Z'),
        new Date('2026-09-25T14:30:00.000Z'),
      );

      expect(result).toEqual({
        conflict: true,
        conflictingAppointment: {
          id: existing.id,
          startsAt: existing.startsAt,
          endsAt: existing.endsAt,
          procedureName: existing.procedureName,
        },
      });
    });

    it('does not flag two appointments that only touch at the boundary', async () => {
      repository.seed(
        buildAppointment({
          startsAt: new Date('2026-09-25T13:00:00.000Z'),
          endsAt: new Date('2026-09-25T14:00:00.000Z'),
        }),
      );

      await expect(
        service.checkConflict(
          USER_ID,
          new Date('2026-09-25T14:00:00.000Z'),
          new Date('2026-09-25T15:00:00.000Z'),
        ),
      ).resolves.toEqual({ conflict: false });
    });

    it('ignores appointments that are not SCHEDULED', async () => {
      repository.seed(
        buildAppointment({
          status: 'CANCELED',
          startsAt: new Date('2026-09-25T13:00:00.000Z'),
          endsAt: new Date('2026-09-25T14:00:00.000Z'),
        }),
      );

      await expect(
        service.checkConflict(
          USER_ID,
          new Date('2026-09-25T13:00:00.000Z'),
          new Date('2026-09-25T14:00:00.000Z'),
        ),
      ).resolves.toEqual({ conflict: false });
    });

    it('ignores another account appointments (ADR-11)', async () => {
      repository.seed(
        buildAppointment({
          userId: OTHER_USER_ID,
          startsAt: new Date('2026-09-25T13:00:00.000Z'),
          endsAt: new Date('2026-09-25T14:00:00.000Z'),
        }),
      );

      await expect(
        service.checkConflict(
          USER_ID,
          new Date('2026-09-25T13:00:00.000Z'),
          new Date('2026-09-25T14:00:00.000Z'),
        ),
      ).resolves.toEqual({ conflict: false });
    });

    it('excludes the appointment being edited from its own check', async () => {
      const existing = buildAppointment({
        startsAt: new Date('2026-09-25T13:00:00.000Z'),
        endsAt: new Date('2026-09-25T14:00:00.000Z'),
      });
      repository.seed(existing);

      await expect(
        service.checkConflict(
          USER_ID,
          new Date('2026-09-25T13:00:00.000Z'),
          new Date('2026-09-25T14:00:00.000Z'),
          existing.id,
        ),
      ).resolves.toEqual({ conflict: false });
    });
  });

  describe('create', () => {
    it('rejects an overlapping appointment with 409 and the clashing appointment', async () => {
      const existing = await service.create(
        USER_ID,
        createDto('2026-09-25T13:00:00.000Z', '2026-09-25T14:00:00.000Z'),
      );

      await expect(
        service.create(
          USER_ID,
          createDto('2026-09-25T13:30:00.000Z', '2026-09-25T14:30:00.000Z'),
        ),
      ).rejects.toMatchObject({
        code: 'APPOINTMENT_TIME_CONFLICT',
        kind: 'CONFLICT',
        details: {
          conflict: true,
          conflictingAppointment: { id: existing.id },
        },
      });
    });

    it('allows a back-to-back appointment right after another ends', async () => {
      await service.create(
        USER_ID,
        createDto('2026-09-25T13:00:00.000Z', '2026-09-25T14:00:00.000Z'),
      );

      await expect(
        service.create(
          USER_ID,
          createDto('2026-09-25T14:00:00.000Z', '2026-09-25T15:00:00.000Z'),
        ),
      ).resolves.toMatchObject({ status: 'SCHEDULED' });
    });

    it('rejects an interval where endsAt is not after startsAt', async () => {
      await expect(
        service.create(
          USER_ID,
          createDto('2026-09-25T14:00:00.000Z', '2026-09-25T14:00:00.000Z'),
        ),
      ).rejects.toBeInstanceOf(DomainError);
    });
  });

  describe('update', () => {
    it('rejects moving an appointment into a slot another one already holds', async () => {
      const first = await service.create(
        USER_ID,
        createDto('2026-09-25T13:00:00.000Z', '2026-09-25T14:00:00.000Z'),
      );
      const second = await service.create(
        USER_ID,
        createDto('2026-09-25T15:00:00.000Z', '2026-09-25T16:00:00.000Z'),
      );

      await expect(
        service.update(second.id, USER_ID, {
          startsAt: '2026-09-25T13:30:00.000Z',
          endsAt: '2026-09-25T14:30:00.000Z',
        }),
      ).rejects.toMatchObject({
        code: 'APPOINTMENT_TIME_CONFLICT',
        details: { conflictingAppointment: { id: first.id } },
      });
    });

    it('does not conflict with itself when the interval is left unchanged', async () => {
      const appointment = await service.create(
        USER_ID,
        createDto('2026-09-25T13:00:00.000Z', '2026-09-25T14:00:00.000Z'),
      );

      await expect(
        service.update(appointment.id, USER_ID, {
          procedureName: 'Consulta de retorno',
        }),
      ).resolves.toMatchObject({ procedureName: 'Consulta de retorno' });
    });

    it('answers 404 for an appointment belonging to another account', async () => {
      const appointment = await service.create(
        USER_ID,
        createDto('2026-09-25T13:00:00.000Z', '2026-09-25T14:00:00.000Z'),
      );

      await expect(
        service.update(appointment.id, OTHER_USER_ID, {
          procedureName: 'Renomeado',
        }),
      ).rejects.toMatchObject({ code: 'APPOINTMENT_NOT_FOUND' });
    });
  });

  describe('registerItems (US06)', () => {
    let appointment: Appointment;

    beforeEach(() => {
      appointment = buildAppointment();
      repository.seed(appointment);
    });

    it('creates an OUTBOUND/APPOINTMENT movement per item, dated at startsAt and costed at the current lot', async () => {
      const item = buildItem({ currentQuantity: new Prisma.Decimal(10) });
      const lot = buildLot(item.id, { unitCost: new Prisma.Decimal('7.25') });
      repository.seedItem(item, [lot]);

      const result = await service.registerItems(appointment.id, USER_ID, {
        items: [{ itemId: item.id, quantity: 3 }],
      });

      expect(result.appointmentId).toBe(appointment.id);
      expect(result.warnings).toEqual([]);
      expect(result.movements).toHaveLength(1);
      expect(result.movements[0]).toMatchObject({
        itemId: item.id,
        lotId: lot.id,
        type: 'OUTBOUND',
        source: 'APPOINTMENT',
        occurredAt: appointment.startsAt,
      });
      expect(result.movements[0].quantity.toString()).toBe('3');
      expect(result.movements[0].unitCost.toString()).toBe('7.25');
      expect(repository.movements[0].appointmentId).toBe(appointment.id);
      expect(repository.items.get(item.id)!.currentQuantity.toString()).toBe(
        '7',
      );
    });

    it('costs the movement at the lot that expires first among those with stock', async () => {
      const item = buildItem();
      const late = buildLot(item.id, {
        expirationDate: new Date('2027-06-30'),
        unitCost: new Prisma.Decimal(20),
      });
      const early = buildLot(item.id, {
        expirationDate: new Date('2026-12-31'),
        unitCost: new Prisma.Decimal(15),
      });
      repository.seedItem(item, [late, early]);

      const result = await service.registerItems(appointment.id, USER_ID, {
        items: [{ itemId: item.id, quantity: 1 }],
      });

      expect(result.movements[0].lotId).toBe(early.id);
      expect(result.movements[0].unitCost.toString()).toBe('15');
    });

    it.each([
      ['more than the balance', 10, 12, '-2', true],
      ['exactly the balance', 10, 10, '0', false],
      ['on an item already negative', -1, 1, '-2', true],
    ])(
      'using %s records the movement and warns only when the balance goes negative',
      async (_label, balance, quantity, expectedBalance, warns) => {
        const item = buildItem({
          currentQuantity: new Prisma.Decimal(balance),
        });
        repository.seedItem(item, [buildLot(item.id)]);

        const result = await service.registerItems(appointment.id, USER_ID, {
          items: [{ itemId: item.id, quantity }],
        });

        expect(result.movements).toHaveLength(1);
        expect(result.warnings).toEqual(
          warns ? [{ warning: 'insufficient_stock', itemId: item.id }] : [],
        );
        const stored = repository.items.get(item.id)!;
        expect(stored.currentQuantity.toString()).toBe(expectedBalance);
        expect(stored.needsAdjustment).toBe(warns);
      },
    );

    it('warns only for the items that went negative, once each', async () => {
      const short = buildItem({ currentQuantity: new Prisma.Decimal(1) });
      const plenty = buildItem({ currentQuantity: new Prisma.Decimal(50) });
      repository.seedItem(short, [buildLot(short.id)]);
      repository.seedItem(plenty, [buildLot(plenty.id)]);

      const result = await service.registerItems(appointment.id, USER_ID, {
        items: [
          { itemId: short.id, quantity: 1 },
          { itemId: plenty.id, quantity: 5 },
          { itemId: short.id, quantity: 1 },
          { itemId: short.id, quantity: 1 },
        ],
      });

      expect(result.movements).toHaveLength(4);
      expect(result.warnings).toEqual([
        { warning: 'insufficient_stock', itemId: short.id },
      ]);
    });

    it('falls back to the item defaultUnitCost when the item has no lot', async () => {
      const item = buildItem({
        currentQuantity: new Prisma.Decimal(0),
        defaultUnitCost: new Prisma.Decimal('4.5'),
      });
      repository.seedItem(item, []);

      const result = await service.registerItems(appointment.id, USER_ID, {
        items: [{ itemId: item.id, quantity: 2 }],
      });

      expect(result.movements[0].lotId).toBeNull();
      expect(result.movements[0].unitCost.toString()).toBe('4.5');
    });

    it('rejects an item with no lot and no defaultUnitCost without recording anything', async () => {
      const costed = buildItem();
      const uncosted = buildItem({ defaultUnitCost: null });
      repository.seedItem(costed, [buildLot(costed.id)]);
      repository.seedItem(uncosted, []);

      await expect(
        service.registerItems(appointment.id, USER_ID, {
          items: [
            { itemId: costed.id, quantity: 1 },
            { itemId: uncosted.id, quantity: 1 },
          ],
        }),
      ).rejects.toMatchObject({
        code: 'ITEM_LOT_UNIT_COST_REQUIRED',
        details: { itemId: uncosted.id },
      });
      expect(repository.movements).toHaveLength(0);
    });

    it('answers 404 for an appointment belonging to another account (ADR-11)', async () => {
      const item = buildItem({ userId: OTHER_USER_ID });
      repository.seedItem(item, [buildLot(item.id)]);

      await expect(
        service.registerItems(appointment.id, OTHER_USER_ID, {
          items: [{ itemId: item.id, quantity: 1 }],
        }),
      ).rejects.toMatchObject({ code: 'APPOINTMENT_NOT_FOUND' });
      expect(repository.movements).toHaveLength(0);
    });

    it.each([
      ['another account', { userId: OTHER_USER_ID }],
      ['a soft-deleted item', { deletedAt: new Date() }],
    ])(
      'answers 404 for an item of %s and records nothing',
      async (_label, overrides) => {
        const mine = buildItem();
        const foreign = buildItem(overrides);
        repository.seedItem(mine, [buildLot(mine.id)]);
        repository.seedItem(foreign, [buildLot(foreign.id)]);

        await expect(
          service.registerItems(appointment.id, USER_ID, {
            items: [
              { itemId: mine.id, quantity: 1 },
              { itemId: foreign.id, quantity: 1 },
            ],
          }),
        ).rejects.toMatchObject({
          code: 'ITEM_NOT_FOUND',
          details: { id: foreign.id },
        });
        expect(repository.movements).toHaveLength(0);
        expect(
          repository.items.get(foreign.id)!.currentQuantity.toString(),
        ).toBe('10');
      },
    );

    describe('idempotency (ADR-08/09)', () => {
      let item: Item;

      beforeEach(() => {
        item = buildItem({ currentQuantity: new Prisma.Decimal(10) });
        repository.seedItem(item, [buildLot(item.id)]);
      });

      it('answers a resent line with the movement already recorded and deducts nothing again', async () => {
        const clientGeneratedId = randomUUID();
        const send = () =>
          service.registerItems(appointment.id, USER_ID, {
            items: [{ clientGeneratedId, itemId: item.id, quantity: 3 }],
          });

        const first = await send();
        const second = await send();

        expect(repository.movements).toHaveLength(1);
        expect(second.movements).toEqual(first.movements);
        expect(second.movements[0].clientGeneratedId).toBe(clientGeneratedId);
        expect(repository.items.get(item.id)!.currentQuantity.toString()).toBe(
          '7',
        );
      });

      it('records only the new lines of a partially resent request, keeping the request order', async () => {
        const replayedKey = randomUUID();
        const newKey = randomUUID();
        await service.registerItems(appointment.id, USER_ID, {
          items: [
            { clientGeneratedId: replayedKey, itemId: item.id, quantity: 1 },
          ],
        });

        const result = await service.registerItems(appointment.id, USER_ID, {
          items: [
            { clientGeneratedId: newKey, itemId: item.id, quantity: 2 },
            { clientGeneratedId: replayedKey, itemId: item.id, quantity: 1 },
          ],
        });

        expect(result.movements.map(m => m.clientGeneratedId)).toEqual([
          newKey,
          replayedKey,
        ]);
        expect(repository.movements).toHaveLength(2);
        expect(repository.items.get(item.id)!.currentQuantity.toString()).toBe(
          '7',
        );
      });

      it('still warns on a pure replay when the item is negative', async () => {
        const clientGeneratedId = randomUUID();
        const send = () =>
          service.registerItems(appointment.id, USER_ID, {
            items: [{ clientGeneratedId, itemId: item.id, quantity: 12 }],
          });

        await send();
        const replay = await send();

        expect(replay.warnings).toEqual([
          { warning: 'insufficient_stock', itemId: item.id },
        ]);
      });

      it.each([
        ['another quantity', { quantity: 4 }],
        ['another item', { itemId: 'other' }],
      ])(
        'rejects a key already used with %s (409) and records nothing',
        async (_label, change) => {
          const other = buildItem({ id: 'other' });
          repository.seedItem(other, [buildLot(other.id)]);
          const clientGeneratedId = randomUUID();
          await service.registerItems(appointment.id, USER_ID, {
            items: [{ clientGeneratedId, itemId: item.id, quantity: 3 }],
          });

          await expect(
            service.registerItems(appointment.id, USER_ID, {
              items: [
                { clientGeneratedId, itemId: item.id, quantity: 3, ...change },
              ],
            }),
          ).rejects.toMatchObject({
            code: 'STOCK_MOVEMENT_CLIENT_ID_CONFLICT',
            details: { clientGeneratedId },
          });
          expect(repository.movements).toHaveLength(1);
        },
      );

      it('rejects a key already used on another appointment (409)', async () => {
        const otherAppointment = buildAppointment();
        repository.seed(otherAppointment);
        const clientGeneratedId = randomUUID();
        await service.registerItems(otherAppointment.id, USER_ID, {
          items: [{ clientGeneratedId, itemId: item.id, quantity: 1 }],
        });

        await expect(
          service.registerItems(appointment.id, USER_ID, {
            items: [{ clientGeneratedId, itemId: item.id, quantity: 1 }],
          }),
        ).rejects.toMatchObject({ code: 'STOCK_MOVEMENT_CLIENT_ID_CONFLICT' });
      });

      it('rejects the same key twice in one request (409) and records nothing', async () => {
        const clientGeneratedId = randomUUID();

        await expect(
          service.registerItems(appointment.id, USER_ID, {
            items: [
              { clientGeneratedId, itemId: item.id, quantity: 1 },
              { clientGeneratedId, itemId: item.id, quantity: 1 },
            ],
          }),
        ).rejects.toMatchObject({ code: 'STOCK_MOVEMENT_CLIENT_ID_CONFLICT' });
        expect(repository.movements).toHaveLength(0);
      });

      it('answers with the winner when a concurrent copy of the request recorded it first', async () => {
        const clientGeneratedId = randomUUID();
        const dto = {
          items: [{ clientGeneratedId, itemId: item.id, quantity: 3 }],
        };
        const winner = await service.registerItems(
          appointment.id,
          USER_ID,
          dto,
        );
        repository.missNextReplayLookup = true;

        const loser = await service.registerItems(appointment.id, USER_ID, dto);

        expect(loser.movements).toEqual(winner.movements);
        expect(repository.movements).toHaveLength(1);
        expect(repository.items.get(item.id)!.currentQuantity.toString()).toBe(
          '7',
        );
      });
    });

    describe('appointment status', () => {
      let item: Item;

      beforeEach(() => {
        item = buildItem({ currentQuantity: new Prisma.Decimal(10) });
        repository.seedItem(item, [buildLot(item.id)]);
      });

      it('rejects a canceled appointment (409) and records nothing', async () => {
        const canceled = buildAppointment({ status: 'CANCELED' });
        repository.seed(canceled);

        await expect(
          service.registerItems(canceled.id, USER_ID, {
            items: [{ itemId: item.id, quantity: 1 }],
          }),
        ).rejects.toMatchObject({
          code: 'APPOINTMENT_CANCELED',
          details: { id: canceled.id },
        });
        expect(repository.movements).toHaveLength(0);
        expect(repository.items.get(item.id)!.currentQuantity.toString()).toBe(
          '10',
        );
      });

      it('accepts a completed appointment', async () => {
        const completed = buildAppointment({ status: 'COMPLETED' });
        repository.seed(completed);

        const result = await service.registerItems(completed.id, USER_ID, {
          items: [{ itemId: item.id, quantity: 1 }],
        });

        expect(result.movements).toHaveLength(1);
      });

      it('rejects (409) when the appointment is canceled after it was read', async () => {
        const racing = buildAppointment();
        repository.seed(racing);
        const findById = repository.findById.bind(repository);
        jest
          .spyOn(repository, 'findById')
          .mockImplementationOnce(async (id, userId) => {
            const row = await findById(id, userId);
            repository.seed({ ...racing, status: 'CANCELED' });
            return row;
          });

        await expect(
          service.registerItems(racing.id, USER_ID, {
            items: [{ itemId: item.id, quantity: 1 }],
          }),
        ).rejects.toMatchObject({ code: 'APPOINTMENT_CANCELED' });
        expect(repository.movements).toHaveLength(0);
      });

      it('still answers a pure replay after the appointment was canceled', async () => {
        const clientGeneratedId = randomUUID();
        const dto = {
          items: [{ clientGeneratedId, itemId: item.id, quantity: 1 }],
        };
        const first = await service.registerItems(appointment.id, USER_ID, dto);
        repository.seed({ ...appointment, status: 'CANCELED' });

        const replay = await service.registerItems(
          appointment.id,
          USER_ID,
          dto,
        );

        expect(replay.movements).toEqual(first.movements);
        expect(repository.movements).toHaveLength(1);
      });
    });
  });

  describe('editItem / removeItem (US06 corrections)', () => {
    let appointment: Appointment;
    let item: Item;
    let lot: ItemLot;
    let supplyId: string;

    const stored = (id: string) => repository.movements.find(m => m.id === id)!;
    const balance = () =>
      repository.items.get(item.id)!.currentQuantity.toString();

    beforeEach(async () => {
      appointment = buildAppointment();
      repository.seed(appointment);
      item = buildItem({ currentQuantity: new Prisma.Decimal(10) });
      lot = buildLot(item.id, { unitCost: new Prisma.Decimal('7.25') });
      repository.seedItem(item, [lot]);
      const registered = await service.registerItems(appointment.id, USER_ID, {
        items: [{ itemId: item.id, quantity: 3 }],
      });
      supplyId = registered.movements[0].id;
    });

    describe('editItem', () => {
      it('reverses the original and records the new quantity at the same lot, cost and date', async () => {
        const result = await service.editItem(
          appointment.id,
          supplyId,
          USER_ID,
          {
            quantity: 5,
          },
        );

        expect(result.reversal).toMatchObject({
          type: 'INBOUND',
          source: 'CORRECTION_REVERSAL',
          reversedMovementId: supplyId,
          lotId: lot.id,
        });
        expect(result.reversal!.quantity.toString()).toBe('3');
        expect(result.movement).toMatchObject({
          type: 'OUTBOUND',
          source: 'APPOINTMENT',
          itemId: item.id,
          lotId: lot.id,
          occurredAt: appointment.startsAt,
        });
        expect(result.movement.quantity.toString()).toBe('5');
        expect(result.movement.unitCost.toString()).toBe('7.25');
        expect(result.warnings).toEqual([]);
        expect(balance()).toBe('5');
        // Append-only: the original row is untouched.
        expect(stored(supplyId).quantity.toString()).toBe('3');
        expect(stored(supplyId).deletedAt).toBeNull();
      });

      it('warns and flags the item when the new quantity takes it negative', async () => {
        const result = await service.editItem(
          appointment.id,
          supplyId,
          USER_ID,
          {
            quantity: 12,
          },
        );

        expect(result.warnings).toEqual([
          { warning: 'insufficient_stock', itemId: item.id },
        ]);
        expect(balance()).toBe('-2');
        expect(repository.items.get(item.id)!.needsAdjustment).toBe(true);
      });

      it('writes nothing when the quantity did not change', async () => {
        const result = await service.editItem(
          appointment.id,
          supplyId,
          USER_ID,
          {
            quantity: 3,
          },
        );

        expect(result.movement.id).toBe(supplyId);
        expect(result.reversal).toBeNull();
        expect(repository.movements).toHaveLength(1);
      });

      it('refuses (409) a movement that was already reversed', async () => {
        await service.editItem(appointment.id, supplyId, USER_ID, {
          quantity: 5,
        });

        await expect(
          service.editItem(appointment.id, supplyId, USER_ID, { quantity: 6 }),
        ).rejects.toMatchObject({
          code: 'STOCK_MOVEMENT_ALREADY_REVERSED',
          details: { id: supplyId },
        });
        expect(repository.movements).toHaveLength(3);
      });

      it('answers a resent edit (same clientGeneratedId) with the movement it created', async () => {
        const dto = { quantity: 5, clientGeneratedId: randomUUID() };
        const first = await service.editItem(
          appointment.id,
          supplyId,
          USER_ID,
          dto,
        );
        const again = await service.editItem(
          appointment.id,
          supplyId,
          USER_ID,
          dto,
        );

        expect(again.movement).toEqual(first.movement);
        expect(again.reversal).toEqual(first.reversal);
        expect(repository.movements).toHaveLength(3);
        expect(balance()).toBe('5');
      });

      it('rejects (409) a clientGeneratedId already used for something else', async () => {
        const clientGeneratedId = randomUUID();
        await service.editItem(appointment.id, supplyId, USER_ID, {
          quantity: 5,
          clientGeneratedId,
        });

        await expect(
          service.editItem(appointment.id, supplyId, USER_ID, {
            quantity: 6,
            clientGeneratedId,
          }),
        ).rejects.toMatchObject({ code: 'STOCK_MOVEMENT_CLIENT_ID_CONFLICT' });
      });

      it('answers with the winner when a concurrent copy of the edit reversed it first', async () => {
        const dto = { quantity: 5, clientGeneratedId: randomUUID() };
        const stale = await repository.findMovement(supplyId, USER_ID);
        const winner = await service.editItem(
          appointment.id,
          supplyId,
          USER_ID,
          dto,
        );
        jest.spyOn(repository, 'findMovement').mockResolvedValueOnce(stale);
        jest
          .spyOn(repository, 'findMovementsByClientGeneratedIds')
          .mockResolvedValueOnce([]);

        const loser = await service.editItem(
          appointment.id,
          supplyId,
          USER_ID,
          dto,
        );

        expect(loser.movement).toEqual(winner.movement);
        expect(repository.movements).toHaveLength(3);
        expect(balance()).toBe('5');
      });

      it('rejects (409) a canceled appointment and writes nothing', async () => {
        repository.seed({ ...appointment, status: 'CANCELED' });

        await expect(
          service.editItem(appointment.id, supplyId, USER_ID, { quantity: 5 }),
        ).rejects.toMatchObject({ code: 'APPOINTMENT_CANCELED' });
        expect(repository.movements).toHaveLength(1);
      });

      it('rejects (409) when the appointment is canceled after it was read', async () => {
        const findById = repository.findById.bind(repository);
        jest
          .spyOn(repository, 'findById')
          .mockImplementationOnce(async (id, userId) => {
            const row = await findById(id, userId);
            repository.seed({ ...appointment, status: 'CANCELED' });
            return row;
          });

        await expect(
          service.editItem(appointment.id, supplyId, USER_ID, { quantity: 5 }),
        ).rejects.toMatchObject({ code: 'APPOINTMENT_CANCELED' });
        expect(repository.movements).toHaveLength(1);
      });

      it('rejects an invalid quantity', async () => {
        await expect(
          service.editItem(appointment.id, supplyId, USER_ID, { quantity: 0 }),
        ).rejects.toMatchObject({ code: 'STOCK_QUANTITY_INVALID' });
      });
    });

    describe('removeItem', () => {
      it('reverses the supply and gives the stock back to the item and lot', async () => {
        const result = await service.removeItem(
          appointment.id,
          supplyId,
          USER_ID,
        );

        expect(result.appointmentId).toBe(appointment.id);
        expect(result.reversal).toMatchObject({
          type: 'INBOUND',
          source: 'CORRECTION_REVERSAL',
          reversedMovementId: supplyId,
          occurredAt: appointment.startsAt,
        });
        expect(balance()).toBe('10');
        expect(lot.currentQuantity.toString()).toBe('10');
      });

      it('is idempotent: removing again answers with the same reversal', async () => {
        const first = await service.removeItem(
          appointment.id,
          supplyId,
          USER_ID,
        );
        const again = await service.removeItem(
          appointment.id,
          supplyId,
          USER_ID,
        );

        expect(again.reversal).toEqual(first.reversal);
        expect(repository.movements).toHaveLength(2);
        expect(balance()).toBe('10');
      });

      it('answers with the winner when a concurrent removal reversed it first', async () => {
        const stale = await repository.findMovement(supplyId, USER_ID);
        const winner = await service.removeItem(
          appointment.id,
          supplyId,
          USER_ID,
        );
        jest.spyOn(repository, 'findMovement').mockResolvedValueOnce(stale);

        const loser = await service.removeItem(
          appointment.id,
          supplyId,
          USER_ID,
        );

        expect(loser.reversal).toEqual(winner.reversal);
        expect(repository.movements).toHaveLength(2);
      });

      it('rejects (409) a canceled appointment and writes nothing', async () => {
        repository.seed({ ...appointment, status: 'CANCELED' });

        await expect(
          service.removeItem(appointment.id, supplyId, USER_ID),
        ).rejects.toMatchObject({ code: 'APPOINTMENT_CANCELED' });
        expect(repository.movements).toHaveLength(1);
      });
    });

    describe('what counts as a supply of this appointment', () => {
      it.each(['editItem', 'removeItem'] as const)(
        '%s answers 404 for a movement of another appointment',
        async method => {
          const other = buildAppointment();
          repository.seed(other);

          await expect(
            method === 'editItem'
              ? service.editItem(other.id, supplyId, USER_ID, { quantity: 1 })
              : service.removeItem(other.id, supplyId, USER_ID),
          ).rejects.toMatchObject({
            code: 'STOCK_MOVEMENT_NOT_FOUND',
            details: { id: supplyId },
          });
        },
      );

      it.each(['editItem', 'removeItem'] as const)(
        '%s answers 404 for a reversal, which is not a supply',
        async method => {
          const { reversal } = await service.removeItem(
            appointment.id,
            supplyId,
            USER_ID,
          );

          await expect(
            method === 'editItem'
              ? service.editItem(appointment.id, reversal.id, USER_ID, {
                  quantity: 1,
                })
              : service.removeItem(appointment.id, reversal.id, USER_ID),
          ).rejects.toMatchObject({ code: 'STOCK_MOVEMENT_NOT_FOUND' });
        },
      );

      it.each(['editItem', 'removeItem'] as const)(
        '%s answers 404 for another account, appointment or movement (ADR-11)',
        async method => {
          await expect(
            method === 'editItem'
              ? service.editItem(appointment.id, supplyId, OTHER_USER_ID, {
                  quantity: 1,
                })
              : service.removeItem(appointment.id, supplyId, OTHER_USER_ID),
          ).rejects.toMatchObject({ code: 'APPOINTMENT_NOT_FOUND' });
          expect(repository.movements).toHaveLength(1);
        },
      );
    });
  });
});
