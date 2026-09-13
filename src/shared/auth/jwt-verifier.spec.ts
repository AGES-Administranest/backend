import { generateKeyPair, JWTVerifyGetKey, SignJWT } from 'jose';

import { CognitoConfig } from './auth.config';
import { CognitoJwtVerifier } from './jwt-verifier';

/**
 * Real RS256 tokens, signed in-process against a key pair generated here.
 *
 * Mocking `jose` would leave the actual verification untested, which is the
 * only thing this class does. Generating a key pair costs milliseconds and
 * keeps the suite off the network.
 */
describe('CognitoJwtVerifier', () => {
  const issuer =
    'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_AkV3Qbw54';
  const clientId = 'u9DC8kEy2p18K30HrRY0XCadtn';

  let privateKey: CryptoKey;
  let keys: JWTVerifyGetKey;
  let strangerKey: CryptoKey;
  let verifier: CognitoJwtVerifier;

  const config: CognitoConfig = {
    jwksUri: 'http://localhost:4566/us-east-1_AkV3Qbw54/.well-known/jwks.json',
    issuer,
    clientId,
    acceptedTokenUse: ['id'],
    subCacheTtlMs: 1000,
    subCacheMaxEntries: 10,
    clockToleranceSec: 5,
  };

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    const stranger = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    strangerKey = stranger.privateKey;
    keys = () => Promise.resolve(pair.publicKey);
    verifier = new CognitoJwtVerifier(config, keys);
  });

  interface TokenOptions {
    claims?: Record<string, unknown>;
    expiresIn?: string;
    signWith?: CryptoKey;
    issuedBy?: string;
  }

  const idClaims = {
    sub: 'e18686f6-f5d4-4077-9b4f-acda47657377',
    token_use: 'id',
    aud: clientId,
    email: 'dev@administranest.local',
  };

  const token = ({
    claims = idClaims,
    expiresIn = '1h',
    signWith,
    issuedBy = issuer,
  }: TokenOptions = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuedAt()
      .setIssuer(issuedBy)
      .setExpirationTime(expiresIn)
      .sign(signWith ?? privateKey);

  const rejectsWith = (promise: Promise<unknown>, code: string) =>
    expect(promise).rejects.toMatchObject({ kind: 'UNAUTHORIZED', code });

  it('accepts a well-formed id token and returns its claims', async () => {
    const claims = await verifier.verify(await token());

    expect(claims.sub).toBe(idClaims.sub);
    expect(claims.email).toBe('dev@administranest.local');
    expect(claims.token_use).toBe('id');
  });

  it('reports an expired token with its own code, so the app can refresh', async () => {
    await rejectsWith(
      verifier.verify(await token({ expiresIn: '-10s' })),
      'TOKEN_EXPIRED',
    );
  });

  it('rejects a token signed by another key', async () => {
    await rejectsWith(
      verifier.verify(await token({ signWith: strangerKey })),
      'TOKEN_INVALID',
    );
  });

  it('rejects a token from another issuer', async () => {
    await rejectsWith(
      verifier.verify(await token({ issuedBy: 'https://evil.example.com' })),
      'TOKEN_INVALID',
    );
  });

  it('rejects a token issued for another app client', async () => {
    await rejectsWith(
      verifier.verify(await token({ claims: { ...idClaims, aud: 'another' } })),
      'TOKEN_INVALID',
    );
  });

  it('rejects an access token while only id tokens are accepted', async () => {
    const access = await token({
      claims: { sub: idClaims.sub, token_use: 'access', client_id: clientId },
    });

    await rejectsWith(verifier.verify(access), 'TOKEN_INVALID');
  });

  it('rejects an id token with no email, which could not be mirrored', async () => {
    const withoutEmail = await token({
      claims: { sub: idClaims.sub, token_use: 'id', aud: clientId },
    });

    await rejectsWith(verifier.verify(withoutEmail), 'TOKEN_INVALID');
  });

  it('rejects something that is not a token at all', async () => {
    await rejectsWith(verifier.verify('not.a.jwt'), 'TOKEN_INVALID');
  });

  it('allows a token just past expiry, for phones with a drifting clock', async () => {
    const claims = await verifier.verify(await token({ expiresIn: '-2s' }));

    expect(claims.sub).toBe(idClaims.sub);
  });

  it('reads the audience from client_id when access tokens are accepted', async () => {
    const acceptsAccess = new CognitoJwtVerifier(
      { ...config, acceptedTokenUse: ['id', 'access'] },
      keys,
    );
    const access = await token({
      claims: { sub: idClaims.sub, token_use: 'access', client_id: clientId },
    });

    await expect(acceptsAccess.verify(access)).resolves.toMatchObject({
      sub: idClaims.sub,
      token_use: 'access',
    });
  });

  it('still checks the audience of an access token', async () => {
    const acceptsAccess = new CognitoJwtVerifier(
      { ...config, acceptedTokenUse: ['id', 'access'] },
      keys,
    );
    const access = await token({
      claims: { sub: idClaims.sub, token_use: 'access', client_id: 'another' },
    });

    await rejectsWith(acceptsAccess.verify(access), 'TOKEN_INVALID');
  });
});
