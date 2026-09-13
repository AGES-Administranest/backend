/**
 * Who is making the request, as established by `JwtAuthGuard`.
 *
 * Everything here comes from the verified token and never from the request
 * body, which is what stops the app from claiming to be someone else (ADR-11).
 */

/**
 * What the token proves on its own.
 *
 * This is all that is available on a route marked `@AllowsUnprovisioned()`,
 * where a local mirror may not exist yet.
 */
export interface CognitoIdentity {
  cognitoSub: string;
  email: string;
  /** Absent on accounts created through `admin-create-user`. */
  name?: string;
}

/**
 * An identity whose local mirror (ADR-02) is known to exist.
 *
 * `id` is required rather than optional on purpose: it is the value every
 * per-user query filters on, and making it non-optional means a repository
 * cannot silently receive `undefined` and fall back to returning everyone's
 * rows. The guard guarantees it by refusing the request when no mirror is
 * found, so a route holding an `AuthenticatedUser` never has to null-check.
 */
export interface AuthenticatedUser extends CognitoIdentity {
  id: string;
}
