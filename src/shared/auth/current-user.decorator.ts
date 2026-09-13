import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { AuthenticatedUser, CognitoIdentity } from './authenticated-user';
import { DomainError } from '../errors/domain-error';

/**
 * The authenticated user, including the local `id` every per-user query needs.
 *
 * `JwtAuthGuard` fills `request.user`. The checks below are not the real
 * defence — the guard is — but they make a route that somehow escaped it fail
 * closed instead of running with nobody attached.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const user = identityOf(context);

    if (!user.id) {
      // Not a caller error: the route is marked @AllowsUnprovisioned(), so no
      // local id was resolved, and it should be asking for @CurrentClaims().
      throw new DomainError(
        'UNAUTHORIZED',
        'USER_NOT_PROVISIONED',
        'No local mirror for this account. Call POST /auth/session first.',
      );
    }

    return user as AuthenticatedUser;
  },
);

/**
 * Only what the token proves, with no local id.
 *
 * For the routes that run before the mirror exists — `POST /auth/session`,
 * which creates it.
 */
export const CurrentClaims = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CognitoIdentity =>
    identityOf(context),
);

/** What the guard attaches: always an identity, with an id once resolved. */
type RequestIdentity = CognitoIdentity & { id?: string };

function identityOf(context: ExecutionContext): RequestIdentity {
  const request = context
    .switchToHttp()
    .getRequest<{ user?: RequestIdentity }>();

  if (!request.user) {
    throw new DomainError(
      'UNAUTHORIZED',
      'UNAUTHENTICATED',
      'Request has no authenticated user',
    );
  }

  return request.user;
}
