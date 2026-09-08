/**
 * Who the request claims to be, with the token already verified.
 *
 * ⚠️ PROVISIONAL — this is the contract agreed with the guard (US34, subtask 2,
 * being developed in parallel). Once the guard lands it takes ownership of this
 * file and of the decorator next to it, and nothing else in the project changes.
 *
 * All three fields are claims from the Cognito IdToken. They come from the
 * token and never from the request body — that is what stops the app from
 * claiming to be someone else.
 */
export interface AuthenticatedUser {
  /** `sub` claim: the user's stable identifier in Cognito. */
  cognitoSub: string;

  /**
   * `email` claim. Cognito is the source of truth (ADR-02), so this value
   * overwrites the local mirror on every login.
   */
  email: string;

  /**
   * `name` claim. The app sends it on `SignUp`, but an account created through
   * `admin-create-user` may not have it — hence optional.
   */
  name?: string;
}
