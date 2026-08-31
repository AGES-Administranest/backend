<!--
  Fill in each section below. Delete the "Example" blockquotes before submitting —
  they're there to show the level of detail we expect, not to be left in the PR.
-->

## Summary
<!-- Bullet list of what changed. One line per change, written for someone who hasn't seen the diff. -->

> Example:
> - Add `POST /users/:id/reset-password` endpoint
> - Add `PasswordResetService` with token generation/expiry logic
> - Add migration for `password_reset_tokens` table

## ClickUp
<!-- Link the ClickUp task this PR addresses. -->

> Example:
> https://app.clickup.com/t/86ab12cde

## Test plan
<!-- Checklist of how you verified the change. Reviewers should be able to redo these steps. -->

> Example:
> - [ ] Unit tests added for `PasswordResetService` (expiry, invalid token, happy path)
> - [ ] Ran migration locally and confirmed table/schema
> - [ ] Hit the endpoint locally with Postman/cURL, confirmed 200 and email dispatch

## Screenshots / recordings
<!-- Include for any change with an observable output: API response payloads, Swagger/docs updates, logs, dashboards. Delete this section if not applicable. -->

> Example:
>
> | Request | Response |
> |---|---|
> | _(screenshot)_ | _(screenshot)_ |
