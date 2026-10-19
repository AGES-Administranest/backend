import { Injectable } from '@nestjs/common';

import { UsersRepository } from './users.repository';
import { AuthUserResolver } from '../../shared/auth/auth-user-resolver';

/**
 * Supplies the guard with the local user id for a Cognito sub.
 *
 * Lives in this module, not in `shared/`, because it touches user data: the
 * repository stays module-private and the guard depends on the interface rather
 * than on `UsersModule` (see `shared/auth/auth-user-resolver.ts`).
 */
@Injectable()
export class CognitoUserResolver implements AuthUserResolver {
  constructor(private readonly usersRepository: UsersRepository) {}

  async resolveId(cognitoSub: string): Promise<string | null> {
    const user = await this.usersRepository.findByCognitoSub(cognitoSub);
    return user?.id ?? null;
  }
}
