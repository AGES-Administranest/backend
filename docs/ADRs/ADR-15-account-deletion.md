# ADR-15 — Account deletion (US25, LGPD)

**Status:**

- [ ] Accepted
- [ ] Rejected

**Context:** LGPD gives the user the right to have their data deleted, and the App Store and Play Store require an in-app way to delete the account. `DELETE /users/me` has to remove the user's data from three places that cannot share a transaction: Postgres, S3 and Cognito. Cognito is the source of truth for credentials (ADR-02), so deleting only the mirror would leave a working login that `POST /auth/session` would quietly rebuild.

## Decisions

### 1. The backend removes the Cognito user (`AdminDeleteUser`)

Options: (a) the app calls `DeleteUser` with the access token, best effort; (b) the backend calls `AdminDeleteUser` after deleting the data.

**Decision: (b).** With (a) the order is the app's, not ours: if it deletes the Cognito user first and our call then fails, the user can no longer sign in to get the fresh token that a retry needs, and the data is stuck. With (b) the Cognito user goes last, so a failure leaves the retry possible.

**The app must remove its own `DeleteUser` call.** While it exists nothing breaks (`UserNotFoundException` is treated as success), but it reintroduces the stuck case above.

### 2. Not atomic across systems: ordered and resumable instead

| Step | Where     | Atomic            |
| ---- | --------- | ----------------- |
| 1    | Postgres  | one transaction   |
| 2    | S3        | after the commit  |
| 3    | Cognito   | last              |

- Step 1 deletes every row the user owns, soft-deleted ones included, and writes the audit row (`account_deletion`) in the same transaction. If it fails, nothing changed: `500 ACCOUNT_DELETION_FAILED`, safe to resend.
- Steps 2 and 3 run only after the commit. Running them before would let a failed transaction leave a user with an intact account and no files or no login.
- If step 2 or 3 fails, the data is already gone: `500 ACCOUNT_DELETION_INCOMPLETE`. The audit row has `storage_purged_at` / `identity_removed_at` as `NULL` for what is pending, and sending `DELETE /users/me` again finishes the job. The route is exempt from the guard's mirror lookup precisely so that this retry still reaches the service.
- S3 is removed by the prefix `users/<id>/` rather than by the keys read from the rows, so files are removed even if their row was already gone.

"Nothing half done" is therefore true of the database and of the user's _view_ of the account (the old token is refused as soon as step 1 commits), but not literally of S3 and Cognito: for the span between a failed step and the next attempt they are pending, and recorded as such.

### 3. Fresh login: `auth_time`

The token must come from a login in the last 5 minutes (`ACCOUNT_DELETION_REAUTH_WINDOW_SEC`, default 300), else `401 REAUTH_REQUIRED`. `auth_time` and not `iat`: a refresh issues a new token with a new `iat` but keeps the original `auth_time`, so only `auth_time` tells a password login from a long-lived session. A token without it fails closed. Already-deleted accounts answer `204` without the check, since nothing is left to protect.

### 4. Deleted accounts cannot come back with the old token

The id token outlives the Cognito user by up to an hour. `POST /auth/session` checks the audit and answers `401 ACCOUNT_DELETED` instead of rebuilding the mirror. Every other route already answers `401 USER_NOT_PROVISIONED`, because the row is gone. The audit keeps a SHA-256 of the Cognito `sub`, not the `sub`.

### 5. Audit without personal data

`account_deletion` holds: the former user id (a random UUID), the hash of the `sub`, the date, `retention_basis`, and the two step timestamps. No name, e-mail, document or `sub`. It has no foreign key to `user`.

### 6. Retention: none in force — **open, needs a legal answer**

The request says "according to the retention policy", but the repository has none and this ADR is not the place to invent one. Today everything the user created is deleted, and the audit records `retention_basis = 'NONE'`.

Before this ships to production someone needs to confirm with legal whether any category must be kept (fiscal documents are the usual candidate, but the notes here are ones the user issued _outside_ the app, so the obligation may be theirs and not ours). If something must be kept, it is anonymized inside the same transaction in `AccountDeletionRepository.purge`, kept out of every user-facing query, and named in `retention_basis`. Note the anonymized rows would need a place to live that has no `user_id` pointing at a deleted user, which is a schema decision to take together with that answer.

### 7. Google (social) accounts

There is no password to ask for, but the rule needs no special case: a Cognito token from a social login carries `auth_time` too, so "a login in the last 5 minutes" means the app runs the Google flow again and sends the new token. Nothing in the backend differs.

**Not verified:** whether a repeated hosted-UI login that the browser session answers silently (ADR-13, _Logout_) renews `auth_time`. If it does not, the app has to force the prompt, or sign out of the hosted UI first. Test this on AWS, not on MiniStack — the emulator's federated tokens differ in other ways (ADR-13, divergences 3 and 6) and may not carry `auth_time` at all.

### 8. Legal documents (items 2 and 3 of the request) — **open**

- `POST /auth/session` and `POST /auth/terms` already return `termsVersion`, `termsAcceptedAt` and `privacyAcceptedAt` as ISO 8601 (null until accepted); `test/auth.e2e-spec.ts` now pins that.
- The public URLs of the Privacy Policy and the Terms of Use are not defined here: they need a domain and somewhere to host the text, which are not in the repository. Whoever owns that should pick URLs that never change (the app reads them from `EXPO_PUBLIC_PRIVACY_POLICY_URL` and `EXPO_PUBLIC_TERMS_OF_USE_URL`) and keep old versions reachable, since `termsVersion` says which text each user accepted.
- When either text changes, bump `TERMS_VERSION` in the app to ask for a new acceptance. The backend stores whatever version the app sends and does not check it against a list.

## Known limits

- **Cache on other instances.** The deleted `sub` is evicted from the `sub → id` cache of the instance that served the request. Other instances keep it for up to `AUTH_SUB_CACHE_TTL_MS` (5 min); in that time a write with the stale id fails on the foreign key instead of creating data.
- **Session race.** If `POST /auth/session` passes its deleted-account check just before a concurrent deletion commits, it can recreate an empty mirror. The next `DELETE /users/me` deletes it for real: the audit row is upserted by the `sub` hash, so the second deletion takes it over and reopens the pending S3 and Cognito steps.
- **Pending steps are finished only by a new request.** There is no sweeper for audit rows with a `NULL` step. If the user never retries, S3 files or the Cognito user stay.
- **Backups.** Deleted rows live on in database backups until they expire. The privacy policy should say so.
- **`DELETE /users/:id`, `GET /users` and `PATCH /users/:id` predate ADR-11** and let any signed-in user act on any other. Unrelated to this change, and worth closing separately.

## Consequences

(+) one call, and the old credentials stop working; (+) a failure at any step is named and retryable; (+) no personal data survives in the audit. (−) the app has to drop its own `DeleteUser`; (−) the API's role needs `cognito-idp:AdminDeleteUser` and `s3:DeleteObject` (`infra/api.yaml`, `infra/storage.yaml`), and `COGNITO_USER_POOL_ID` is now required at startup; (−) retention and the legal URLs are open.
