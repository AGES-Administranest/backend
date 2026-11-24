import {
  InvalidReferenceError,
  UniqueConstraintError,
} from '../../../src/infra/prisma/prisma-errors';
import { SupplierService } from '../../../src/modules/supplier/supplier.service';

const USER = 'user-1';

describe('SupplierService.findNames', () => {
  const findNames = jest.fn();

  beforeEach(() => findNames.mockReset());

  it('maps each id to its name', async () => {
    findNames.mockResolvedValue([{ id: 'a', name: 'Ana' }]);

    await expect(
      new SupplierService({ findNames } as never).findNames(USER, [
        'a',
        'gone',
      ]),
    ).resolves.toEqual(new Map([['a', 'Ana']]));
    expect(findNames).toHaveBeenCalledWith(USER, ['a', 'gone']);
  });

  it('does not query without ids', async () => {
    await expect(
      new SupplierService({ findNames } as never).findNames(USER, []),
    ).resolves.toEqual(new Map());
    expect(findNames).not.toHaveBeenCalled();
  });
});

describe('SupplierService failures', () => {
  const dto = { name: 'Vet Supplies' };

  it.each([
    [
      'a reference that does not exist',
      new InvalidReferenceError('userId'),
      { code: 'INVALID_REFERENCE', details: { field: 'userId' } },
    ],
    [
      'a collision that is not the tax id',
      new UniqueConstraintError(['id']),
      { name: 'UniqueConstraintError' },
    ],
  ])('reports %s on create and on update', async (_case, error, expected) => {
    const service = new SupplierService({
      create: jest.fn().mockRejectedValue(error),
      update: jest.fn().mockRejectedValue(error),
    } as never);

    await expect(service.create(USER, dto)).rejects.toMatchObject(expected);
    await expect(service.update('supplier-1', USER, dto)).rejects.toMatchObject(
      expected,
    );
  });
});
