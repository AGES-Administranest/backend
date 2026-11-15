/**
 * How old the login behind the token may be, in seconds. Deleting an account
 * cannot be undone, so a token that merely refreshed an old session is not
 * enough: the app asks for the password again and sends the new token.
 */
export const DEFAULT_REAUTH_WINDOW_SEC = 300;

/**
 * Why data survived the deletion, as recorded in the audit row.
 *
 * `NONE`: the deletion removes everything the user created. There is no
 * retention policy in force yet (see ADR-15). The day the law is confirmed to
 * require keeping something, that category is anonymized inside the same
 * transaction in `AccountDeletionRepository.purge`, and this value becomes the
 * legal basis, so the audit says what was kept and why.
 */
export const RETENTION_BASIS_NONE = 'NONE';
