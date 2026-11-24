import { MeasurementUnit } from '@prisma/client';

import { ItemRepository } from '../../../src/modules/item/item.repository';

const USER = 'user-1';
const ITEM = 'item-1';

describe('ItemRepository', () => {
  let item: Record<string, jest.Mock>;
  let repository: ItemRepository;

  beforeEach(() => {
    item = {
      findMany: jest.fn().mockResolvedValue([{ id: ITEM }]),
      findFirst: jest.fn().mockResolvedValue({ id: ITEM }),
      create: jest.fn().mockResolvedValue({ id: ITEM }),
      update: jest.fn().mockResolvedValue({ id: ITEM }),
      delete: jest.fn().mockResolvedValue({ id: ITEM }),
    };
    repository = new ItemRepository({
      item,
      $transaction: (work: (tx: unknown) => unknown) => work({ item }),
    } as never);
  });

  it('finds an item only for its owner', async () => {
    await repository.findById(ITEM, USER);

    expect(item.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ITEM, userId: USER } }),
    );
  });

  it('keeps of the ids only the active items of the user', async () => {
    await expect(
      repository.findActiveIds(USER, [ITEM, 'foreign']),
    ).resolves.toEqual([ITEM]);
    expect(item.findMany).toHaveBeenCalledWith({
      where: { id: { in: [ITEM, 'foreign'] }, userId: USER, active: true },
      select: { id: true },
    });
  });

  it('reads a lean catalog of active items', async () => {
    await repository.findCatalog(USER);

    expect(item.findMany).toHaveBeenCalledWith({
      where: { userId: USER, active: true },
      select: { id: true, name: true, unit: true },
    });
  });

  it.each([
    [undefined, {}],
    [ITEM, { id: { not: ITEM } }],
  ])('finds a repeated presentation (excluding %s)', async (except, extra) => {
    await repository.findByPresentation(
      USER,
      'Propofol',
      MeasurementUnit.AMPOULE,
      except,
    );

    expect(item.findFirst).toHaveBeenCalledWith({
      where: {
        userId: USER,
        name: 'Propofol',
        unit: MeasurementUnit.AMPOULE,
        active: true,
        ...extra,
      },
    });
  });

  it('creates, and hard deletes only what was just created', async () => {
    await repository.create({ name: 'Propofol' } as never);
    await expect(repository.purgeNew(ITEM)).resolves.toBeUndefined();

    expect(item.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'Propofol' } }),
    );
    expect(item.delete).toHaveBeenCalledWith({ where: { id: ITEM } });
  });

  it('updates and soft deletes after checking the owner', async () => {
    await repository.update(ITEM, USER, { name: 'Ketamine' });
    await repository.delete(ITEM, USER);

    expect(item.findFirst).toHaveBeenCalledWith({
      where: { id: ITEM, userId: USER },
      select: { id: true },
    });
    expect(item.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: ITEM },
        data: { name: 'Ketamine' },
      }),
    );
    expect(item.update).toHaveBeenNthCalledWith(2, {
      where: { id: ITEM },
      data: { active: false, deletedAt: expect.any(Date) as Date },
    });
    expect(item.delete).not.toHaveBeenCalled();
  });

  it('writes nothing to the item of someone else', async () => {
    item.findFirst.mockResolvedValue(null);

    await expect(repository.update(ITEM, 'user-2', {})).resolves.toBeNull();
    await expect(repository.delete(ITEM, 'user-2')).resolves.toBeNull();
    expect(item.update).not.toHaveBeenCalled();
  });
});
