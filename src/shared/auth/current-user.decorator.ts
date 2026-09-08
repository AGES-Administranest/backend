import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { AuthenticatedUser } from './authenticated-user';
import { DomainError } from '../errors/domain-error';

/**
 * Hands the request's user to the controller.
 *
 * ⚠️ PROVISIONAL — see `authenticated-user.ts`. What fills `request.user` is the
 * guard from subtask 2, which does not exist yet. Until then, every route using
 * this decorator answers 401 with `NAO_AUTENTICADO`: that is the correct answer
 * (the request really was not authenticated) and it keeps the endpoint from
 * looking like it works while nobody has checked the token.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();

    if (!request.user) {
      throw new DomainError(
        'UNAUTHORIZED',
        'NAO_AUTENTICADO',
        'Request has no authenticated user',
      );
    }

    return request.user;
  },
);
