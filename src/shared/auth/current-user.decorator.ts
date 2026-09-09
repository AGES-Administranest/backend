import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { AuthenticatedUser } from './authenticated-user';
import { DomainError } from '../errors/domain-error';

/**
 * PROVISIONAL — see `authenticated-user.ts`. What fills `request.user` is the
 * guard from US34 subtask 2. Until it lands every route using this answers 401,
 * which beats looking like it works while nobody checked the token.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();

    if (!request.user) {
      throw new DomainError(
        'UNAUTHORIZED',
        'UNAUTHENTICATED',
        'Request has no authenticated user',
      );
    }

    return request.user;
  },
);
