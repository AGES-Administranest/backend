import {
  Item,
  ItemCategory,
  ItemLot,
  MeasurementUnit,
  Prisma,
} from '@prisma/client';

const { Decimal } = Prisma;

import { CreateItemLotDto } from '../../../src/modules/item/dto/create-item-lot.dto';
import { ItemLotService } from '../../../src/modules/item/item-lot.service';
import { StockMovementsService } from '../../../src/modules/stock-movements';
import { DomainError } from '../../../src/shared/errors/domain-error';

const item = (overrides: Partial<Item> = {}): Item => ({
  id: 'item-1',
  userId: 'user-1',
  supplierId: null,
  category: ItemCategory.MEDICATION,
  unit: MeasurementUnit.AMPOULE,
  name: 'Dipirona injetável',
  defaultUnitCost: new Decimal(10),
  minimumStock: new Decimal(5),
  currentQuantity: new Decimal(0),
  needsAdjustment: false,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  ...overrides,
});

const lot = (overrides: Partial<ItemLot> = {}): ItemLot => ({
  id: 'lot-1',
  itemId: 'item-1',
  lotNumber: null,
  expirationDate: null,
  unitCost: new Decimal(10),
  currentQuantity: new Decimal(5),
  receivedOn: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const createDto = (
  overrides: Partial<CreateItemLotDto> = {},
): CreateItemLotDto =>
  Object.assign(new CreateItemLotDto(), {
    quantity: 5,
    ...overrides,
  });

type LotStub = (tx: unknown) => Promise<{ lotId: string; unitCost?: unknown }>;

/** Stands in for the Prisma transaction client the ledger passes down. */
const TX = {} as never;

describe('ItemLotService', () => {
  let repository: {
    findItemForUser: jest.Mock;
    findByExpiration: jest.Mock;
    addQuantity: jest.Mock;
    createLot: jest.Mock;
  };
  let stockMovements: { record: jest.Mock };
  let service: ItemLotService;

  beforeEach(() => {
    repository = {
      findItemForUser: jest.fn(),
      findByExpiration: jest.fn(),
      addQuantity: jest.fn(),
      createLot: jest.fn(),
    };
    // Receiving a lot is a stock movement, so the lot rules now run inside the
    // ledger's transaction. The stub stands in for that transaction: it calls
    // the resolver the service handed it, exactly as the real service does.
    stockMovements = {
      record: jest.fn(
        async (_userId: string, input: { resolveLot?: LotStub }) =>
          input.resolveLot ? { lot: await input.resolveLot(TX) } : {},
      ),
    };
    service = new ItemLotService(
      repository as never,
      stockMovements as unknown as StockMovementsService,
    );
  });

  it('lança NOT_FOUND quando o item não existe ou não pertence ao usuário', async () => {
    repository.findItemForUser.mockResolvedValue(null);

    await expect(
      service.create('item-1', 'user-1', createDto()),
    ).rejects.toMatchObject({
      code: 'ITEM_NOT_FOUND',
    } satisfies Partial<DomainError>);
    expect(repository.findByExpiration).not.toHaveBeenCalled();
  });

  it('não enxerga um item de outro usuário (ADR-11)', async () => {
    repository.findItemForUser.mockResolvedValue(null);

    // The owner now comes from the token, so the lookup is always scoped to
    // whoever is calling — there is no longer a field in the request that
    // could name someone else.
    await expect(
      service.create('item-1', 'user-2', createDto()),
    ).rejects.toMatchObject({ code: 'ITEM_NOT_FOUND' });
    expect(repository.findItemForUser).toHaveBeenCalledWith('item-1', 'user-2');
  });

  it('soma na mesma remessa quando a validade já cadastrada é idêntica', async () => {
    const existingLot = lot();
    repository.findItemForUser.mockResolvedValue(item());
    repository.findByExpiration.mockResolvedValue(existingLot);
    repository.addQuantity.mockResolvedValue(
      lot({ currentQuantity: new Decimal(10) }),
    );

    const result = await service.create(
      'item-1',
      'user-1',
      createDto({ expirationDate: '2026-12-31' }),
    );

    expect(repository.addQuantity).toHaveBeenCalledWith(existingLot.id, 5, TX);
    expect(repository.createLot).not.toHaveBeenCalled();
    expect(result.currentQuantity).toEqual(new Decimal(10));
  });

  it('cria um novo lote quando a validade é diferente', async () => {
    repository.findItemForUser.mockResolvedValue(item());
    repository.findByExpiration.mockResolvedValue(null);
    repository.createLot.mockResolvedValue(lot({ id: 'lot-2' }));

    const result = await service.create(
      'item-1',
      'user-1',
      createDto({ expirationDate: '2027-01-15' }),
    );

    expect(repository.createLot).toHaveBeenCalledWith(
      'item-1',
      expect.objectContaining({ quantity: 5, unitCost: 10 }),
      TX,
    );
    expect(result.id).toBe('lot-2');
  });

  it('usa o defaultUnitCost do item quando unitCost não é informado', async () => {
    repository.findItemForUser.mockResolvedValue(
      item({ defaultUnitCost: new Decimal(7.5) }),
    );
    repository.findByExpiration.mockResolvedValue(null);
    repository.createLot.mockResolvedValue(lot());

    await service.create('item-1', 'user-1', createDto());

    expect(repository.createLot).toHaveBeenCalledWith(
      'item-1',
      expect.objectContaining({ unitCost: 7.5 }),
      TX,
    );
  });

  it('lança erro de validação quando não há unitCost nem defaultUnitCost', async () => {
    repository.findItemForUser.mockResolvedValue(
      item({ defaultUnitCost: null }),
    );
    repository.findByExpiration.mockResolvedValue(null);

    await expect(
      service.create('item-1', 'user-1', createDto()),
    ).rejects.toMatchObject({
      code: 'ITEM_LOT_UNIT_COST_REQUIRED',
    } satisfies Partial<DomainError>);
    expect(repository.createLot).not.toHaveBeenCalled();
  });

  it('records the entry through the stock ledger, never on its own', async () => {
    repository.findItemForUser.mockResolvedValue(item());
    repository.findByExpiration.mockResolvedValue(null);
    repository.createLot.mockResolvedValue(lot({ id: 'lot-9' }));

    await service.create('item-1', 'user-1', createDto({ unitCost: 12 }));

    // ADR-10: `stock_movement` and `item.current_quantity` have exactly one
    // writer, and this module is not it.
    expect(stockMovements.record).toHaveBeenCalledTimes(1);
    const [userId, input] = stockMovements.record.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(userId).toBe('user-1');
    expect(input).toMatchObject({
      itemId: 'item-1',
      type: 'INBOUND',
      source: 'MANUAL_PURCHASE',
      quantity: 5,
      unitCost: 12,
    });
  });

  it('prices the movement with the existing lot cost, not the item default', async () => {
    // Topping up a lot bought at 4 does not become stock worth the item's
    // current price: the movement has to carry what this stock actually cost.
    repository.findItemForUser.mockResolvedValue(
      item({ defaultUnitCost: new Decimal(10) }),
    );
    repository.findByExpiration.mockResolvedValue(
      lot({ unitCost: new Decimal(4) }),
    );
    repository.addQuantity.mockResolvedValue(lot());

    await service.create('item-1', 'user-1', createDto());

    const resolved = (
      await (stockMovements.record.mock.results[0].value as Promise<{
        lot: { unitCost: Prisma.Decimal };
      }>)
    ).lot;
    expect(resolved.unitCost).toEqual(new Decimal(4));
  });
});
