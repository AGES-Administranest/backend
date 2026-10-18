/** Same as the `VARCHAR(n)` columns: nothing that passes validation overflows. */
export const PLACE_MAX_LENGTH = 200;

/**
 * Ceilings for one trip, well under what the DECIMAL columns hold, so a typo
 * is a 400 instead of an overflow that would reach Postgres as a 500. The
 * longest drive within Brazil is under 5,000 km.
 */
export const MAX_DISTANCE_KM = 5000;
export const MAX_RIDE_COST = 10000;
