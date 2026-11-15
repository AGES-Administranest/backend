/**
 * The account's identity at the provider that issues the tokens.
 *
 * Abstract class and not an interface: Nest injects by token, and an interface
 * leaves nothing behind at runtime. Cognito is the only implementation; the
 * seam is what lets the service be tested without a pool.
 */
export abstract class IdentityProviderGateway {
  /**
   * Removes the user so that the old credentials stop working. Idempotent: a
   * user that is already gone is a success, because that is the state wanted.
   *
   * @param username What the provider's admin API takes. The token's
   *   `cognito:username`, or the `sub` when the token carries none.
   */
  abstract deleteUser(username: string): Promise<void>;
}
