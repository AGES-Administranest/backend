import {
  RecordNotFoundError,
  UniqueConstraintError,
} from '../../../src/infra/prisma/prisma-errors';
import { UsersService } from '../../../src/modules/users/users.service';

const user = { id: 'user-1', name: 'Ana', email: 'ana@example.com' };
const dto = { name: 'Ana', email: 'ana@example.com' };

describe('UsersService — CRUD', () => {
  let repository: Record<string, jest.Mock>;
  let service: UsersService;

  beforeEach(() => {
    repository = {
      findMany: jest.fn().mockResolvedValue([user]),
      findById: jest.fn().mockResolvedValue(user),
      create: jest.fn().mockResolvedValue(user),
      update: jest.fn().mockResolvedValue(user),
      delete: jest.fn().mockResolvedValue(user),
      updateByCognitoSub: jest.fn(),
    };
    service = new UsersService(repository as never);
  });

  it('lists the users', async () => {
    await expect(service.findAll()).resolves.toEqual([user]);
  });

  it('finds one user', async () => {
    await expect(service.findOne('user-1')).resolves.toBe(user);
  });

  it('creates a user stamping updatedAt', async () => {
    await expect(service.create(dto as never)).resolves.toBe(user);
    expect(repository.create).toHaveBeenCalledWith({
      ...dto,
      updatedAt: expect.any(Date) as Date,
    });
  });

  it('updates a user', async () => {
    await expect(service.update('user-1', { name: 'Bia' })).resolves.toBe(user);
    expect(repository.update).toHaveBeenCalledWith('user-1', { name: 'Bia' });
  });

  it('removes a user without answering the row', async () => {
    await expect(service.remove('user-1')).resolves.toBeUndefined();
    expect(repository.delete).toHaveBeenCalledWith('user-1');
  });

  it('reports a repeated e-mail on create and on update', async () => {
    const taken = new UniqueConstraintError(['email']);
    repository.create.mockRejectedValue(taken);
    repository.update.mockRejectedValue(taken);

    const expected = { code: 'USER_EMAIL_ALREADY_REGISTERED' };
    await expect(service.create(dto as never)).rejects.toMatchObject(expected);
    await expect(service.update('user-1', dto)).rejects.toMatchObject(expected);
  });

  it('reports a missing user on update and on remove', async () => {
    repository.update.mockRejectedValue(new RecordNotFoundError());
    repository.delete.mockRejectedValue(new RecordNotFoundError());

    const expected = { code: 'USER_NOT_FOUND', details: { id: 'user-1' } };
    await expect(service.update('user-1', dto)).rejects.toMatchObject(expected);
    await expect(service.remove('user-1')).rejects.toMatchObject(expected);
  });

  it('lets an unknown failure through untouched', async () => {
    const failure = new Error('connection lost');
    repository.create.mockRejectedValue(failure);
    repository.update.mockRejectedValue(failure);
    repository.delete.mockRejectedValue(failure);
    repository.updateByCognitoSub.mockRejectedValue(failure);

    await expect(service.create(dto as never)).rejects.toBe(failure);
    await expect(service.update('user-1', dto)).rejects.toBe(failure);
    await expect(service.updateProfile('user-1', {})).rejects.toBe(failure);
    await expect(service.remove('user-1')).rejects.toBe(failure);
    await expect(service.acceptTerms('sub-1', 'v1')).rejects.toBe(failure);
  });
});
