import { Logger } from '@nestjs/common';
import { createRemoteJWKSet, errors, JWTVerifyGetKey, jwtVerify } from 'jose';

import { CognitoConfig } from './auth.config';
import { audienceOf, CognitoClaims } from './cognito-claims';
import { DomainError } from '../errors/domain-error';

/**
 * Checks that a token really came from our Cognito pool (ADR-12).
 *
 * The only file that imports `jose`. Everything above it sees claims or a
 * `DomainError`, never a library error.
 *
 * There is no development bypass, by design: the emulator signs with a real
 * RS256 key published on a real JWKS, so the same verification runs locally and
 * in production and only the URL differs.
 */
export class CognitoJwtVerifier {
  private readonly logger = new Logger(CognitoJwtVerifier.name);
  private readonly keys: JWTVerifyGetKey;

  /**
   * @param keys Overrides the remote key set. Tests pass a locally generated
   *   key here, which is what keeps them off the network without having to mock
   *   the library whose behaviour is the thing under test.
   */
  constructor(
    private readonly config: CognitoConfig,
    keys?: JWTVerifyGetKey,
  ) {
    // Built once: this object *is* the JWKS cache. It fetches on first use,
    // keeps the keys in memory, and only refetches when a token arrives with a
    // `kid` it has never seen — rate limited, so an unknown kid cannot be used
    // to hammer the pool.
    this.keys = keys ?? createRemoteJWKSet(new URL(config.jwksUri));
  }

  async verify(token: string): Promise<CognitoClaims> {
    const claims = await this.verifySignature(token);

    // `jose` checked the signature, `iss` and `exp`. The rest is Cognito's
    // shape, which it knows nothing about.
    if (!this.config.acceptedTokenUse.includes(claims.token_use)) {
      throw this.invalid(`token_use is "${claims.token_use}"`);
    }
    if (audienceOf(claims) !== this.config.clientId) {
      throw this.invalid('audience does not match the app client');
    }
    if (!claims.sub?.trim()) {
      throw this.invalid('sub is missing');
    }
    // Only the id token carries it, and the mirror cannot be created without
    // it. Failing here rather than at the database keeps the error honest.
    if (claims.token_use === 'id' && !claims.email?.trim()) {
      throw this.invalid('id token carries no email claim');
    }

    return claims;
  }

  private async verifySignature(token: string): Promise<CognitoClaims> {
    try {
      const { payload } = await jwtVerify(token, this.keys, {
        issuer: this.config.issuer,
        algorithms: ['RS256'],
        clockTolerance: this.config.clockToleranceSec,
        // `audience` is deliberately not passed: `jose` would check `aud`, and
        // an access token carries the value as `client_id`. Checked by hand
        // above, through `audienceOf`.
      });
      return payload as unknown as CognitoClaims;
    } catch (error) {
      throw this.translate(error);
    }
  }

  /**
   * Everything except expiry collapses into one code.
   *
   * Telling a caller *why* their token failed — bad signature vs. wrong issuer
   * vs. unknown key — helps nobody but whoever is forging it. The specific
   * reason is logged here and dropped from the response.
   */
  private translate(error: unknown): Error {
    if (error instanceof errors.JWTExpired) {
      return new DomainError(
        'UNAUTHORIZED',
        'TOKEN_EXPIRED',
        'The access token has expired',
      );
    }

    if (
      error instanceof errors.JWTClaimValidationFailed ||
      error instanceof errors.JWSSignatureVerificationFailed ||
      error instanceof errors.JWSInvalid ||
      error instanceof errors.JWTInvalid ||
      error instanceof errors.JWKSNoMatchingKey ||
      error instanceof errors.JWKSMultipleMatchingKeys
    ) {
      return this.invalid(error.message);
    }

    // Anything left is our infrastructure, not the caller's token: the JWKS
    // endpoint being unreachable is the usual one. Let it surface as a 500 so
    // it gets looked at, instead of telling the app its token is bad.
    return error instanceof Error ? error : new Error(String(error));
  }

  private invalid(reason: string): DomainError {
    this.logger.debug(`Rejected token: ${reason}`);
    return new DomainError(
      'UNAUTHORIZED',
      'TOKEN_INVALID',
      'The access token is not valid',
    );
  }
}
