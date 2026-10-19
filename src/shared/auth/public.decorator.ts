import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:isPublic';

/**
 * Lets a route through with no token at all.
 *
 * Protected is the default, so opening a route is a visible, deliberate line in
 * a diff rather than something anyone can do by forgetting a decorator. Reach
 * for it only where there is genuinely no user yet.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
