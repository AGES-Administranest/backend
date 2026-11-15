import { AccountDeletionService } from '../../../src/modules/account-deletion';
import { UsersController } from '../../../src/modules/users/users.controller';
import { UsersService } from '../../../src/modules/users/users.service';

describe('UsersController — GET /users/me', () => {
  it('reads the profile of the user in the token, not of any id', async () => {
    const findProfile = jest.fn().mockResolvedValue({ id: 'id-1' });
    const controller = new UsersController(
      { findProfile } as unknown as UsersService,
      {} as unknown as AccountDeletionService,
    );

    const profile = await controller.findMe({
      id: 'id-1',
      cognitoSub: 'sub-123',
      email: 'ana@example.com',
    });

    expect(findProfile).toHaveBeenCalledWith('id-1');
    expect(profile).toEqual({ id: 'id-1' });
  });
});

describe('UsersController — PATCH /users/me', () => {
  it('updates the profile of the user in the token, not of any id', async () => {
    const updateProfile = jest.fn().mockResolvedValue({ id: 'id-1' });
    const controller = new UsersController(
      { updateProfile } as unknown as UsersService,
      {} as unknown as AccountDeletionService,
    );
    const body = { city: 'Porto Alegre' };

    const profile = await controller.updateMe(
      { id: 'id-1', cognitoSub: 'sub-123', email: 'ana@example.com' },
      body,
    );

    expect(updateProfile).toHaveBeenCalledWith('id-1', body);
    expect(profile).toEqual({ id: 'id-1' });
  });
});
