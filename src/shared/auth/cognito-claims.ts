/**
 * The claims a Cognito token carries, and the one rule for reading them that
 * differs between the two kinds of token.
 *
 * Deliberately free of `jose` and of Nest: the verifier's tests build these as
 * plain objects, so the id-token/access-token split can be exercised without
 * signing anything.
 */

/** Which token Cognito issued. The backend accepts `id` — see `auth.config.ts`. */
export type TokenUse = 'id' | 'access';

export interface CognitoClaims {
  sub: string;
  iss: string;
  token_use: TokenUse;
  exp: number;
  /** Id tokens only. The access token names the same value `client_id`. */
  aud?: string;
  /** Access tokens only. */
  client_id?: string;
  /** Id tokens only, and the reason this project validates the id token. */
  email?: string;
  /** Absent on accounts created through `admin-create-user`. */
  name?: string;
}

/**
 * The app client the token was issued for.
 *
 * Cognito puts it under a different name depending on the token: `aud` on id
 * tokens, `client_id` on access tokens. `jose` only knows how to check `aud`,
 * so the audience comparison happens by hand in the verifier and this is the
 * function that hides the difference.
 */
export function audienceOf(claims: CognitoClaims): string | undefined {
  return claims.token_use === 'access' ? claims.client_id : claims.aud;
}
