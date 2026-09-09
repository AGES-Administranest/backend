/**
 * PROVISIONAL — the contract agreed with the guard (US34 subtask 2, in
 * parallel). The guard takes ownership of this file when it lands.
 *
 * These are IdToken claims. They come from the token and never from the request
 * body, which is what stops the app from claiming to be someone else.
 */
export interface AuthenticatedUser {
  cognitoSub: string;
  email: string;
  /** Absent on accounts created through `admin-create-user`. */
  name?: string;
}
