import { UsersController } from '../../../src/modules/users/users.controller';
import { UsersService } from '../../../src/modules/users/users.service';

describe('UsersController — GET /users/me', () => {
  it('reads the profile of the user in the token, not of any id', async () => {
    const findProfile = jest.fn().mockResolvedValue({ id: 'id-1' });
    const controller = new UsersController({
      findProfile,
    } as unknown as UsersService);

    const profile = await controller.findMe({
      id: 'id-1',
      cognitoSub: 'sub-123',
      email: 'ana@example.com',
    });

    expect(findProfile).toHaveBeenCalledWith('id-1');
    expect(profile).toEqual({ id: 'id-1' });
  });
});
