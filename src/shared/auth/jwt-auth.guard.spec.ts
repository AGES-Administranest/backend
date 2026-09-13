import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AllowsUnprovisioned } from './allows-unprovisioned.decorator';
import { AuthUserResolver } from './auth-user-resolver';
import { AuthenticatedUser } from './authenticated-user';
import { CognitoClaims } from './cognito-claims';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CognitoJwtVerifier } from './jwt-verifier';
import { Public } from './public.decorator';
import { SubIdCache } from './sub-id-cache';
import { DomainError } from '../errors/domain-error';

/**
 * A real `Reflector` reading real decorators, so the metadata lookup is
 * exercised rather than simulated. Only the verifier and the resolver are
 * fakes: one would need a key pair, the other a database.
 */
describe('JwtAuthGuard', () => {
  const claimsOf = (overrides: Partial<CognitoClaims> = {}): CognitoClaims => ({
    sub: 'sub-ana',
    iss: 'https://cognito-idp.us-east-1.amazonaws.com/pool',
    token_use: 'id',
    exp: 0,
    aud: 'client',
    email: 'ana@example.com',
    name: 'Ana Souza',
    ...overrides,
  });

  // Decorated the way a controller is, so the Reflector reads real metadata
  // instead of a simulation of it.
  class Routes {
    @Public()
    open() {}
    guarded() {}
    @AllowsUnprovisioned()
    unprovisioned() {}
  }

  @Public()
  class OpenController {
    anything() {}
  }

  /**
   * Nest hands a guard the route handler by itself, so the spec does too. The
   * prototype lookup is wrapped here because reading a method off an object to
   * pass it elsewhere is exactly what `unbound-method` warns about, and the
   * warning does not apply to metadata lookup.
   */
  const routeOf = (
    cls: abstract new (...args: never[]) => unknown,
    name: string,
  ): ((...args: never[]) => unknown) =>
    (cls.prototype as Record<string, unknown>)[name] as (
      ...args: never[]
    ) => unknown;

  interface Request {
    headers: Record<string, unknown>;
    user?: AuthenticatedUser;
  }

  const contextFor = (
    request: Request,
    handler: (...args: never[]) => unknown,
    cls: unknown = Routes,
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => cls,
    }) as unknown as ExecutionContext;

  const withToken = (token = 'a.b.c'): Request => ({
    headers: { authorization: `Bearer ${token}` },
  });

  let resolverCalls: string[];
  let clock: number;

  const build = ({
    claims = claimsOf(),
    verifyError,
    id = 'user-1',
  }: {
    claims?: CognitoClaims;
    verifyError?: Error;
    id?: string | null;
  } = {}) => {
    resolverCalls = [];
    const verifier = {
      verify: () =>
        verifyError ? Promise.reject(verifyError) : Promise.resolve(claims),
    } as unknown as CognitoJwtVerifier;
    const resolver: AuthUserResolver = {
      resolveId: (cognitoSub: string) => {
        resolverCalls.push(cognitoSub);
        return Promise.resolve(id);
      },
    };
    const cache = new SubIdCache(1000, 10, () => clock);
    return new JwtAuthGuard(new Reflector(), verifier, resolver, cache);
  };

  beforeEach(() => {
    clock = 0;
  });

  describe('routes that need no token', () => {
    it('lets a @Public() handler through without looking at the header', async () => {
      const request: Request = { headers: {} };
      const guard = build();

      await expect(
        guard.canActivate(contextFor(request, routeOf(Routes, 'open'))),
      ).resolves.toBe(true);
      expect(request.user).toBeUndefined();
    });

    it('honours @Public() placed on the controller', async () => {
      const request: Request = { headers: {} };
      const guard = build();

      await expect(
        guard.canActivate(
          contextFor(
            request,
            routeOf(OpenController, 'anything'),
            OpenController,
          ),
        ),
      ).resolves.toBe(true);
    });
  });

  describe('the Authorization header', () => {
    const rejected = (headers: Record<string, unknown>) =>
      build().canActivate(contextFor({ headers }, routeOf(Routes, 'guarded')));

    it('refuses a request with no header', async () => {
      await expect(rejected({})).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });

    it('refuses another authentication scheme', async () => {
      await expect(
        rejected({ authorization: 'Basic dXNlcjpwYXNz' }),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('refuses a Bearer with nothing after it', async () => {
      await expect(rejected({ authorization: 'Bearer' })).rejects.toMatchObject(
        { code: 'UNAUTHENTICATED' },
      );
    });

    it('accepts the scheme in any case, as RFC 7235 allows', async () => {
      const request: Request = { headers: { authorization: 'bearer a.b.c' } };

      await expect(
        build().canActivate(contextFor(request, routeOf(Routes, 'guarded'))),
      ).resolves.toBe(true);
    });
  });

  describe('a verified token', () => {
    it('attaches the identity and the local id', async () => {
      const request = withToken();

      await build().canActivate(
        contextFor(request, routeOf(Routes, 'guarded')),
      );

      expect(request.user).toEqual({
        id: 'user-1',
        cognitoSub: 'sub-ana',
        email: 'ana@example.com',
        name: 'Ana Souza',
      });
    });

    it('omits the name when the token carries no name claim', async () => {
      const request = withToken();
      const guard = build({ claims: claimsOf({ name: undefined }) });

      await guard.canActivate(contextFor(request, routeOf(Routes, 'guarded')));

      expect(request.user).not.toHaveProperty('name');
    });

    it('passes a token failure through untouched', async () => {
      const expired = new DomainError(
        'UNAUTHORIZED',
        'TOKEN_EXPIRED',
        'expired',
      );
      const guard = build({ verifyError: expired });

      await expect(
        guard.canActivate(contextFor(withToken(), routeOf(Routes, 'guarded'))),
      ).rejects.toBe(expired);
    });
  });

  describe('when no local mirror exists', () => {
    it('refuses and names the endpoint that creates it', async () => {
      const guard = build({ id: null });

      await expect(
        guard.canActivate(contextFor(withToken(), routeOf(Routes, 'guarded'))),
      ).rejects.toMatchObject({
        kind: 'UNAUTHORIZED',
        code: 'USER_NOT_PROVISIONED',
      });
    });

    it('still runs a route marked @AllowsUnprovisioned(), with no id', async () => {
      const request = withToken();
      const guard = build({ id: null });

      await expect(
        guard.canActivate(
          contextFor(request, routeOf(Routes, 'unprovisioned')),
        ),
      ).resolves.toBe(true);
      expect(request.user).toEqual({
        cognitoSub: 'sub-ana',
        email: 'ana@example.com',
        name: 'Ana Souza',
      });
      // Nothing to look up: the route is the one that creates the row.
      expect(resolverCalls).toEqual([]);
    });

    it('does not remember the refusal, so the next call can succeed', async () => {
      let id: string | null = null;
      const verifier = {
        verify: () => Promise.resolve(claimsOf()),
      } as unknown as CognitoJwtVerifier;
      const resolver: AuthUserResolver = {
        resolveId: () => Promise.resolve(id),
      };
      const guard = new JwtAuthGuard(
        new Reflector(),
        verifier,
        resolver,
        new SubIdCache(1000, 10, () => clock),
      );

      await expect(
        guard.canActivate(contextFor(withToken(), routeOf(Routes, 'guarded'))),
      ).rejects.toMatchObject({ code: 'USER_NOT_PROVISIONED' });

      id = 'user-1';
      const request = withToken();
      await guard.canActivate(contextFor(request, routeOf(Routes, 'guarded')));

      expect(request.user?.id).toBe('user-1');
    });
  });

  describe('the sub to id cache', () => {
    it('asks the database once for repeated requests', async () => {
      const guard = build();

      await guard.canActivate(
        contextFor(withToken(), routeOf(Routes, 'guarded')),
      );
      await guard.canActivate(
        contextFor(withToken(), routeOf(Routes, 'guarded')),
      );
      await guard.canActivate(
        contextFor(withToken(), routeOf(Routes, 'guarded')),
      );

      expect(resolverCalls).toEqual(['sub-ana']);
    });

    it('asks again once the entry has expired', async () => {
      const guard = build();

      await guard.canActivate(
        contextFor(withToken(), routeOf(Routes, 'guarded')),
      );
      clock += 1000;
      await guard.canActivate(
        contextFor(withToken(), routeOf(Routes, 'guarded')),
      );

      expect(resolverCalls).toEqual(['sub-ana', 'sub-ana']);
    });

    it('reads the e-mail from the token, never from the cached row', async () => {
      const guard = build();
      await guard.canActivate(
        contextFor(withToken(), routeOf(Routes, 'guarded')),
      );

      // Cognito is the source of truth for the e-mail (ADR-02): a change there
      // has to show up on the very next request, cache or no cache.
      const renamed = build({
        claims: claimsOf({ email: 'ana.souza@example.com' }),
      });
      const request = withToken();
      await renamed.canActivate(
        contextFor(request, routeOf(Routes, 'guarded')),
      );

      expect(request.user?.email).toBe('ana.souza@example.com');
    });
  });
});
