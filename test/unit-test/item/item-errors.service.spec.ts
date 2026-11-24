import {
  InvalidReferenceError,
  RecordNotFoundError,
} from '../../../src/infra/prisma/prisma-errors';
import { ItemService } from '../../../src/modules/item/item.service';

const USER = 'user-1';
const ID = 'item-1';

describe('ItemService failures', () => {
  let repository: Record<string, jest.Mock>;
  let service: ItemService;

  beforeEach(() => {
    repository = {
      findCatalog: jest.fn().mockResolvedValue([{ id: ID }]),
      findActiveIds: jest.fn().mockResolvedValue([ID]),
      findById: jest.fn().mockResolvedValue({ id: ID, name: 'Propofol' }),
      findByPresentation: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    service = new ItemService(repository as never, {} as never, {} as never);
  });

  it('reads catalog and active ids for the given user', async () => {
    await expect(service.findCatalog(USER)).resolves.toEqual([{ id: ID }]);
    await expect(service.findActiveIds(USER, [ID, 'x'])).resolves.toEqual([ID]);
    expect(repository.findActiveIds).toHaveBeenCalledWith(USER, [ID, 'x']);
  });

  it.each([
    ['belongs to someone else', null, undefined],
    ['vanished mid-write', undefined, new RecordNotFoundError()],
  ])('reports an item that %s as not found', async (_case, value, error) => {
    for (const method of ['update', 'delete']) {
      if (error) repository[method].mockRejectedValue(error);
      else repository[method].mockResolvedValue(value);
    }

    const expected = { code: 'ITEM_NOT_FOUND', details: { id: ID } };
    await expect(service.update(ID, USER, {})).rejects.toMatchObject(expected);
    await expect(service.remove(ID, USER)).rejects.toMatchObject(expected);
  });

  it('names the reference an update points at wrongly', async () => {
    repository.update.mockRejectedValue(
      new InvalidReferenceError('supplierId'),
    );

    await expect(service.update(ID, USER, {})).rejects.toMatchObject({
      code: 'INVALID_REFERENCE',
      details: { field: 'supplierId' },
    });
  });

  it('lets an unknown failure through', async () => {
    const failure = new Error('connection lost');
    repository.create.mockRejectedValue(failure);
    repository.update.mockRejectedValue(failure);
    repository.delete.mockRejectedValue(failure);

    await expect(service.create(USER, {} as never)).rejects.toBe(failure);
    await expect(service.update(ID, USER, {})).rejects.toBe(failure);
    await expect(service.remove(ID, USER)).rejects.toBe(failure);
  });
});
