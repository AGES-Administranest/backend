/**
 * The largest JSON body the API reads, applied in `main.ts` and in the e2e app.
 *
 * Express defaults to 100 kB, which a stock entry's review outgrows at about
 * 450 lines — well short of the `MAX_DRAFT_LINES` its DTO accepts. Every field
 * of those 2,000 lines at its maximum length comes to about 2.5 MB, so this is
 * the smallest round limit under which any body that passes validation can
 * also be read. Past it the request answers 413 `REQUEST_TOO_LARGE`.
 */
export const JSON_BODY_LIMIT = '3mb';
