/**
 * How the guard finds the local user behind a token, without `shared/` having
 * to know that `modules/users` exists.
 *
 * The guard is cross-cutting and the mirror is user data, so the dependency is
 * inverted: this file declares what the guard needs, and `UsersModule` supplies
 * it. That keeps `UsersRepository` private to its module — the only way in from
 * outside stays the service — and lets the guard's own tests hand it a fake.
 */
export const AUTH_USER_RESOLVER = Symbol('AUTH_USER_RESOLVER');

export interface AuthUserResolver {
  /**
   * The local user id for a Cognito sub, or null when no mirror exists yet.
   *
   * Null is an ordinary answer, not a failure: it is what a first-time account
   * looks like before `POST /auth/session` runs.
   */
  resolveId(cognitoSub: string): Promise<string | null>;
}
