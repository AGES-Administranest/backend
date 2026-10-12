/** A week has 168 hours: more than that is a typo, not a work schedule. */
export const MAX_WEEKLY_HOURS = 168;

export const MAX_SAFETY_MARGIN_PCT = 100;

/**
 * The largest value `DECIMAL(14, 2)` holds. A goal past it would reach
 * Postgres and come back as a 500 instead of a 400.
 */
export const MAX_MONTHLY_INCOME_GOAL = 999_999_999_999.99;

/** Same scale as the columns: nothing that passes validation gets rounded. */
export const PRICING_DECIMAL_PLACES = 2;
