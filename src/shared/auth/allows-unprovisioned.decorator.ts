import { SetMetadata } from '@nestjs/common';

export const ALLOWS_UNPROVISIONED_KEY = 'auth:allowsUnprovisioned';

/**
 * Runs the route even when the caller has no local mirror yet.
 *
 * The token is still verified — this is not `@Public()`. What it lifts is only
 * the requirement that a `user` row already exists, which `POST /auth/session`
 * needs because it is the endpoint that creates that row.
 *
 * A route marked this way gets `@CurrentClaims()`, not `@CurrentUser()`: there
 * is no local id to hand it.
 */
export const AllowsUnprovisioned = () =>
  SetMetadata(ALLOWS_UNPROVISIONED_KEY, true);
