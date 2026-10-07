/** Same as the `VARCHAR(n)` columns: nothing that passes validation overflows. */
export const BRAND_MAX_LENGTH = 60;
export const MODEL_MAX_LENGTH = 120;

/**
 * Sanity ceilings, well under what the DECIMAL columns hold. They also catch a
 * typo such as 1250 for 12.50; a value past the column would otherwise reach
 * Postgres and come back as a 500.
 */
export const MAX_AVG_CONSUMPTION_KM_L = 100;
export const MAX_FUEL_PRICE = 100;
