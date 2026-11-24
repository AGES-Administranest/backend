import { ConfigService } from '@nestjs/config';

import { loadCognitoConfig } from '../../../../src/shared/auth/auth.config';

const ISSUER = 'https://cognito-idp.us-east-1.amazonaws.com/pool-1';

const load = (settings: Record<string, string>) =>
  loadCognitoConfig({
    get: (name: string) => settings[name],
  } as unknown as ConfigService);

const required = { COGNITO_ISSUER: ISSUER, COGNITO_CLIENT_ID: 'client-1' };

describe('loadCognitoConfig', () => {
  it('fills in the defaults', () => {
    expect(load(required)).toEqual({
      issuer: ISSUER,
      clientId: 'client-1',
      jwksUri: `${ISSUER}/.well-known/jwks.json`,
      acceptedTokenUse: ['id'],
      subCacheTtlMs: 300_000,
      subCacheMaxEntries: 10_000,
      clockToleranceSec: 5,
    });
  });

  it('takes the key set from the environment when it is given', () => {
    const { jwksUri } = load({
      ...required,
      COGNITO_JWKS_URI: ' http://localhost:4566/pool-1/jwks.json ',
    });

    expect(jwksUri).toBe('http://localhost:4566/pool-1/jwks.json');
  });

  it.each(['COGNITO_ISSUER', 'COGNITO_CLIENT_ID'])(
    'refuses to start without %s',
    key => {
      expect(() => load({ ...required, [key]: '   ' })).toThrow(
        `${key} is not set`,
      );
    },
  );

  it.each([
    ['AUTH_SUB_CACHE_TTL_MS', 'subCacheTtlMs'],
    ['AUTH_SUB_CACHE_MAX_ENTRIES', 'subCacheMaxEntries'],
    ['AUTH_CLOCK_TOLERANCE_SEC', 'clockToleranceSec'],
  ] as const)('reads %s', (key, field) => {
    expect(load({ ...required, [key]: '0' })[field]).toBe(0);
    expect(load({ ...required, [key]: '42' })[field]).toBe(42);
    expect(() => load({ ...required, [key]: '-1' })).toThrow(key);
    expect(() => load({ ...required, [key]: 'soon' })).toThrow(key);
  });

  it('treats a blank number as not set', () => {
    expect(
      load({ ...required, AUTH_CLOCK_TOLERANCE_SEC: ' ' }).clockToleranceSec,
    ).toBe(5);
  });
});
