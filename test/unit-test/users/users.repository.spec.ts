import { UsersRepository } from '../../../src/modules/users/users.repository';

const data = { name: 'Ana', email: 'ana@example.com' } as never;

describe('UsersRepository', () => {
  let user: Record<string, jest.Mock>;
  let repository: UsersRepository;

  beforeEach(() => {
    user = Object.fromEntries(
      ['findMany', 'findUnique', 'update', 'upsert', 'create', 'delete'].map(
        name => [name, jest.fn().mockResolvedValue({ id: 'user-1' })],
      ),
    );
    repository = new UsersRepository({ user } as never);
  });

  it('lists the newest users first', async () => {
    await repository.findMany();

    expect(user.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
    });
  });

  it('looks a user up by id and by Cognito sub', async () => {
    await repository.findById('user-1');
    await repository.findByCognitoSub('sub-1');

    expect(user.findUnique).toHaveBeenNthCalledWith(1, {
      where: { id: 'user-1' },
    });
    expect(user.findUnique).toHaveBeenNthCalledWith(2, {
      where: { cognitoSub: 'sub-1' },
    });
  });

  it('writes by Cognito sub in a single statement', async () => {
    await repository.updateByCognitoSub('sub-1', { termsVersion: 'v1' });
    await repository.upsertByCognitoSub('sub-1', data, { email: 'new' });

    expect(user.update).toHaveBeenCalledWith({
      where: { cognitoSub: 'sub-1' },
      data: { termsVersion: 'v1' },
    });
    expect(user.upsert).toHaveBeenCalledWith({
      where: { cognitoSub: 'sub-1' },
      create: data,
      update: { email: 'new' },
    });
    expect(user.findUnique).not.toHaveBeenCalled();
  });

  it('creates, updates and deletes by id', async () => {
    await repository.create(data);
    await repository.update('user-1', { name: 'Bia' });
    await repository.delete('user-1');

    expect(user.create).toHaveBeenCalledWith({ data });
    expect(user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { name: 'Bia' },
    });
    expect(user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
  });
});
