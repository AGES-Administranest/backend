import { ClientService } from '../../../src/modules/client/client.service';

const USER = 'user-1';

describe('ClientService.findNames', () => {
  const findNames = jest.fn();

  beforeEach(() => findNames.mockReset());

  it('maps each id to its name', async () => {
    findNames.mockResolvedValue([{ id: 'a', name: 'Ana' }]);

    await expect(
      new ClientService(
        { findNames } as never,
        {} as never,
        {} as never,
      ).findNames(USER, ['a', 'gone']),
    ).resolves.toEqual(new Map([['a', 'Ana']]));
    expect(findNames).toHaveBeenCalledWith(USER, ['a', 'gone']);
  });

  it('does not query without ids', async () => {
    await expect(
      new ClientService(
        { findNames } as never,
        {} as never,
        {} as never,
      ).findNames(USER, []),
    ).resolves.toEqual(new Map());
    expect(findNames).not.toHaveBeenCalled();
  });
});
