import { ItemLotRepository } from '../../../src/modules/item/item-lot.repository';

const EXPIRES = new Date('2027-01-01');
const RECEIVED = new Date('2026-10-01');

const client = () => ({
  item: { findFirst: jest.fn().mockResolvedValue(null) },
  itemLot: {
    findFirst: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue({}),
    create: jest.fn().mockResolvedValue({}),
  },
});

describe('ItemLotRepository', () => {
  let prisma: ReturnType<typeof client>;
  let tx: ReturnType<typeof client>;
  let repository: ItemLotRepository;

  beforeEach(() => {
    prisma = client();
    tx = client();
    repository = new ItemLotRepository(prisma as never);
  });

  it('finds an item only for its owner', async () => {
    await repository.findItemForUser('item-1', 'user-1');

    expect(prisma.item.findFirst).toHaveBeenCalledWith({
      where: { id: 'item-1', userId: 'user-1' },
    });
  });

  it.each([[EXPIRES], [null]])(
    'finds the lot of an expiration date (%p)',
    async expirationDate => {
      await repository.findByExpiration('item-1', expirationDate);

      expect(prisma.itemLot.findFirst).toHaveBeenCalledWith({
        where: { itemId: 'item-1', expirationDate },
      });
    },
  );

  it('tops a lot up with an increment, never a read-then-write', async () => {
    await repository.addQuantity('lot-1', 5);

    expect(prisma.itemLot.update).toHaveBeenCalledWith({
      where: { id: 'lot-1' },
      data: { currentQuantity: { increment: 5 } },
    });
  });

  it('creates a lot holding the quantity received', async () => {
    await repository.createLot('item-1', {
      quantity: 5,
      unitCost: 12.5,
      expirationDate: EXPIRES,
      receivedOn: RECEIVED,
      lotNumber: 'L1',
    });

    expect(prisma.itemLot.create).toHaveBeenCalledWith({
      data: {
        itemId: 'item-1',
        lotNumber: 'L1',
        expirationDate: EXPIRES,
        unitCost: 12.5,
        currentQuantity: 5,
        receivedOn: RECEIVED,
      },
    });
  });

  it('stays inside the transaction of the ledger when given one', async () => {
    await repository.findByExpiration('item-1', null, tx as never);
    await repository.addQuantity('lot-1', 1, tx as never);
    await repository.createLot(
      'item-1',
      { quantity: 1, unitCost: 1, expirationDate: null, receivedOn: RECEIVED },
      tx as never,
    );

    expect(tx.itemLot.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.itemLot.update).toHaveBeenCalledTimes(1);
    expect(tx.itemLot.create).toHaveBeenCalledTimes(1);
    expect(prisma.itemLot.findFirst).not.toHaveBeenCalled();
    expect(prisma.itemLot.update).not.toHaveBeenCalled();
    expect(prisma.itemLot.create).not.toHaveBeenCalled();
  });
});
