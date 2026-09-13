import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ALLOWS_UNPROVISIONED_KEY } from './allows-unprovisioned.decorator';
import { AUTH_USER_RESOLVER } from './auth-user-resolver';
// `import type` is required by `emitDecoratorMetadata` on a decorated signature.
import type { AuthUserResolver } from './auth-user-resolver';
import { CognitoIdentity } from './authenticated-user';
import { CognitoJwtVerifier } from './jwt-verifier';
import { IS_PUBLIC_KEY } from './public.decorator';
import { SubIdCache } from './sub-id-cache';
import { DomainError } from '../errors/domain-error';

/** `Bearer <token>`, with the scheme matched case-insensitively as RFC 7235 asks. */
const BEARER = /^Bearer +(.+)$/i;

/**
 * Establishes who is making the request, for every route that is not
 * explicitly public.
 *
 * The US-34 rule is that there is no use of the system without an account, so
 * this is registered globally and a route becomes reachable without a token
 * only by saying so with `@Public()`. Forgetting a decorator leaves a route
 * protected rather than open.
 *
 * It reads and never writes. A valid token with no local mirror is refused with
 * `USER_NOT_PROVISIONED` instead of creating the row here: provisioning is what
 * `POST /auth/session` does, and doing it again on every request would mean a
 * write — with a unique-constraint race of its own — on the path of every GET.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: CognitoJwtVerifier,
    @Inject(AUTH_USER_RESOLVER) private readonly resolver: AuthUserResolver,
    private readonly cache: SubIdCache,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.hasFlag(context, IS_PUBLIC_KEY)) return true;

    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, unknown>; user?: unknown }>();

    const claims = await this.verifier.verify(bearerFrom(request.headers));
    const identity: CognitoIdentity = {
      cognitoSub: claims.sub,
      email: claims.email!,
      ...(claims.name ? { name: claims.name } : {}),
    };

    if (this.hasFlag(context, ALLOWS_UNPROVISIONED_KEY)) {
      request.user = identity;
      return true;
    }

    request.user = { ...identity, id: await this.localId(claims.sub) };
    return true;
  }

  private async localId(cognitoSub: string): Promise<string> {
    const cached = this.cache.get(cognitoSub);
    if (cached) return cached;

    const id = await this.resolver.resolveId(cognitoSub);
    if (!id) {
      // Deliberately not cached: the app's next move is to create the mirror,
      // and a remembered "no" would lock it out for the whole TTL.
      throw new DomainError(
        'UNAUTHORIZED',
        'USER_NOT_PROVISIONED',
        'No local mirror for this account. Call POST /auth/session first.',
      );
    }

    this.cache.set(cognitoSub, id);
    return id;
  }

  /** Handler first, then controller, so a method can open or close a whole class. */
  private hasFlag(context: ExecutionContext, key: string): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(key, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false
    );
  }
}

function bearerFrom(headers: Record<string, unknown>): string {
  const header = headers.authorization;
  const match = typeof header === 'string' ? BEARER.exec(header) : null;

  if (!match) {
    throw new DomainError(
      'UNAUTHORIZED',
      'UNAUTHENTICATED',
      'Missing or malformed Authorization header',
    );
  }

  return match[1].trim();
}
