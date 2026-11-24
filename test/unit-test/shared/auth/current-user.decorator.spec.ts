import { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

import {
  CurrentClaims,
  CurrentUser,
} from '../../../../src/shared/auth/current-user.decorator';

type Factory = (data: unknown, context: ExecutionContext) => unknown;

/** Nest keeps the factory of a param decorator in the route's metadata. */
const factoryOf = (decorator: () => ParameterDecorator): Factory => {
  class Probe {
    route(@decorator() value: unknown) {
      return value;
    }
  }
  const args = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    Probe,
    'route',
  ) as Record<string, { factory: Factory }>;
  return Object.values(args)[0].factory;
};

const contextOf = (user?: unknown) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

const user = { id: 'user-1', cognitoSub: 'sub-1', email: 'user@example.com' };

describe('CurrentUser', () => {
  const currentUser = factoryOf(CurrentUser);

  it('hands over the user the guard attached', () => {
    expect(currentUser(undefined, contextOf(user))).toBe(user);
  });

  it('fails closed when nobody is attached', () => {
    expect(() => currentUser(undefined, contextOf())).toThrow(
      expect.objectContaining({ code: 'UNAUTHENTICATED' }) as Error,
    );
  });

  it('fails closed when the local id was not resolved', () => {
    const claims = { cognitoSub: user.cognitoSub, email: user.email };

    expect(() => currentUser(undefined, contextOf(claims))).toThrow(
      expect.objectContaining({ code: 'USER_NOT_PROVISIONED' }) as Error,
    );
  });
});

describe('CurrentClaims', () => {
  const currentClaims = factoryOf(CurrentClaims);

  it('does not need a local id', () => {
    const claims = { cognitoSub: 'sub-1', email: 'user@example.com' };

    expect(currentClaims(undefined, contextOf(claims))).toBe(claims);
  });

  it('fails closed when nobody is attached', () => {
    expect(() => currentClaims(undefined, contextOf())).toThrow(
      expect.objectContaining({ code: 'UNAUTHENTICATED' }) as Error,
    );
  });
});
