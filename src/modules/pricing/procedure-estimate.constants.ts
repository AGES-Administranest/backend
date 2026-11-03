/** 24 hours: a longer procedure is a typo, not a quote. */
export const MAX_PROCEDURE_MINUTES = 1440;

/** The same ceiling as the supplies registered on an appointment. */
export const MAX_ESTIMATED_SUPPLIES = 100;

/**
 * A ceiling for one line, well under what the cost arithmetic handles, so a
 * typo is a 400 instead of a nonsensical price.
 */
export const MAX_SUPPLY_QUANTITY = 10000;
