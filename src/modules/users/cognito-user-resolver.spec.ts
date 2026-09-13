import { User } from '@prisma/client';

import { CognitoUserResolver } from './cognito-user-resolver';
import { UsersRepository } from './users.repository';

describe('CognitoUserResolver', () => {
  const ana = {
    id: 'user-1',
    cognitoSub: 'sub-ana',
    email: 'ana@example.com',
    name: 'Ana Souza',
  } as User;

  const resolverOver = (found: User | null) =>
    new CognitoUserResolver({
      findByCognitoSub: () => Promise.resolve(found),
    } as unknown as UsersRepository);

  it('answers the local id for a sub that has a mirror', async () => {
    await expect(resolverOver(ana).resolveId('sub-ana')).resolves.toBe(
      'user-1',
    );
  });

  it('answers null when no mirror exists yet', async () => {
    // Not an error: this is what an account looks like between signing up in
    // Cognito and calling POST /auth/session.
    await expect(resolverOver(null).resolveId('sub-new')).resolves.toBeNull();
  });

  it('asks the repository for the sub it was given', async () => {
    const seen: string[] = [];
    const resolver = new CognitoUserResolver({
      findByCognitoSub: (cognitoSub: string) => {
        seen.push(cognitoSub);
        return Promise.resolve(null);
      },
    } as unknown as UsersRepository);

    await resolver.resolveId('sub-bruno');

    expect(seen).toEqual(['sub-bruno']);
  });
});
