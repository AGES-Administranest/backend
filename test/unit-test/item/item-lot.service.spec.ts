import { Item, ItemCategory, ItemLot, MeasurementUnit, Prisma } from '@prisma/client';

const { Decimal } = Prisma;

import { CreateItemLotDto } from '../../../src/modules/item/dto/create-item-lot.dto';
import { ItemLotService } from '../../../src/modules/item/item-lot.service';
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

const createDto = (overrides: Partial<CreateItemLotDto> = {}): CreateItemLotDto =>
  Object.assign(new CreateItemLotDto(), { userId: 'user-1', quantity: 5, ...overrides });

describe('ItemLotService', () => {
  let repository: {
    findItemForUser: jest.Mock;
    findByExpiration: jest.Mock;
    addToLot: jest.Mock;
    createLot: jest.Mock;
  };
  let service: ItemLotService;

  beforeEach(() => {
    repository = {
      findItemForUser: jest.fn(),
      findByExpiration: jest.fn(),
      addToLot: jest.fn(),
      createLot: jest.fn(),
    };
    service = new ItemLotService(repository as never);
  });

  it('lança NOT_FOUND quando o item não existe ou não pertence ao usuário', async () => {
    repository.findItemForUser.mockResolvedValue(null);

    await expect(
      service.create('item-1', createDto()),
    ).rejects.toMatchObject({
      code: 'ITEM_NOT_FOUND',
    } satisfies Partial<DomainError>);
    expect(repository.findByExpiration).not.toHaveBeenCalled();
  });

  it('não enxerga um item de outro usuário (ADR-11)', async () => {
    repository.findItemForUser.mockResolvedValue(null);

    await expect(
      service.create('item-1', createDto({ userId: 'user-2' })),
    ).rejects.toMatchObject({ code: 'ITEM_NOT_FOUND' });
    expect(repository.findItemForUser).toHaveBeenCalledWith('item-1', 'user-2');
  });

  it('soma na mesma remessa quando a validade já cadastrada é idêntica', async () => {
    const existingLot = lot();
    repository.findItemForUser.mockResolvedValue(item());
    repository.findByExpiration.mockResolvedValue(existingLot);
    repository.addToLot.mockResolvedValue(
      lot({ currentQuantity: new Decimal(10) }),
    );

    const result = await service.create(
      'item-1',
      createDto({ expirationDate: '2026-12-31' }),
    );

    expect(repository.addToLot).toHaveBeenCalledWith(existingLot, 'user-1', 5);
    expect(repository.createLot).not.toHaveBeenCalled();
    expect(result.currentQuantity).toEqual(new Decimal(10));
  });

  it('cria um novo lote quando a validade é diferente', async () => {
    repository.findItemForUser.mockResolvedValue(item());
    repository.findByExpiration.mockResolvedValue(null);
    repository.createLot.mockResolvedValue(lot({ id: 'lot-2' }));

    const result = await service.create(
      'item-1',
      createDto({ expirationDate: '2027-01-15' }),
    );

    expect(repository.createLot).toHaveBeenCalledWith(
      'item-1',
      'user-1',
      expect.objectContaining({ quantity: 5, unitCost: 10 }),
    );
    expect(result.id).toBe('lot-2');
  });

  it('usa o defaultUnitCost do item quando unitCost não é informado', async () => {
    repository.findItemForUser.mockResolvedValue(item({ defaultUnitCost: new Decimal(7.5) }));
    repository.findByExpiration.mockResolvedValue(null);
    repository.createLot.mockResolvedValue(lot());

    await service.create('item-1', createDto());

    expect(repository.createLot).toHaveBeenCalledWith(
      'item-1',
      'user-1',
      expect.objectContaining({ unitCost: 7.5 }),
    );
  });

  it('lança erro de validação quando não há unitCost nem defaultUnitCost', async () => {
    repository.findItemForUser.mockResolvedValue(item({ defaultUnitCost: null }));
    repository.findByExpiration.mockResolvedValue(null);

    await expect(service.create('item-1', createDto())).rejects.toMatchObject({
      code: 'ITEM_LOT_UNIT_COST_REQUIRED',
    } satisfies Partial<DomainError>);
    expect(repository.createLot).not.toHaveBeenCalled();
  });
});
