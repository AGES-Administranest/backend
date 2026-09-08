---
name: backend-code-review
description: Review a change against this backend's own rules — the ADRs in docs/, the ESLint boundary rules, per-user isolation, the closed error-code catalog, soft delete, and the schema conventions. Use when reviewing a PR, a branch, or uncommitted work in this repository, instead of a generic code review that does not know what ADR-11 or DomainError are here.
---

# Reviewing a change in this backend

A generic review finds generic things. This repository has written-down decisions —
twelve ADRs in `docs/ADRs/`, two ESLint-enforced boundary rules, a closed error-code
catalog — and most of what actually goes wrong here is a violation of one of those,
not a missing null check.

Review against the rules below. Report what you find ordered by what it costs if it
ships, not by where it appears in the diff.

## 0. Do not review what a tool already owns

Run these first and let them speak:

```sh
npm run lint && npm run format:check && npm run typecheck && npm test
```

If they pass, then **formatting, import order, naming convention, floating promises,
and cross-module import boundaries are already reviewed.** Do not spend a single
comment on them — the README says it plainly: "formatting is Prettier's job, not code
review's". A review that lands three comments about quote style and misses an
unfiltered query is worse than no review.

If they fail, that is the finding. Stop and report it rather than reviewing around it.

## 1. Per-user isolation — check this before anything else

ADR-11 is the rule the whole product rests on: there are no roles and no permissions,
every professional sees only their own data, and **one unfiltered query leaks another
professional's records.**

For every query the diff adds or touches on a user-owned table:

- Does it filter by user? A `findMany`, `findFirst`, `count`, `aggregate` or
  `updateMany` without a `userId` in the `where` is a finding, always.
- **Where does that user id come from?** The only acceptable answer is the
  authenticated token. A `userId` read from the request body, a route param, or a
  query string is a finding even when the query does filter — the caller just picks
  whose data to read.
- Does a resource belonging to someone else answer **404, not 403**? A 403 confirms
  the record exists, which turns the endpoint into a way to probe other people's data.
- Is there a test with **two different users** proving one cannot see or affect the
  other's rows? ADR-11 calls this the mandatory mitigation, in its own words: "if you
  only write one kind of test in the whole project, make it this one." A new
  user-owned module without that test is an incomplete change, not a nitpick.

`src/modules/users/` is the README's reference module but it is **not** the example to
copy here — it *is* the user table, so it has no `user_id` to filter by. Anyone who
copies it gets a module with no isolation. Say so when you see it happen.

## 2. Layers (ADR-01)

- Prisma is touched **only** in `*.repository.ts`. A service calling `this.prisma.*`
  is a finding.
- Every repository method goes through `runQuery()`. Without it a `P2002` escapes as a
  raw Prisma error, and the global filter turns it into a 500 instead of the 409 it
  should be.
- Business rules live in the service. An `if` in the controller deciding something, or
  logic after awaiting the service, means the rule moved up a layer and can no longer
  be unit-tested without HTTP.
- The controller never has `try/catch` and never sets a status by hand. Everything
  thrown is shaped by `AllExceptionsFilter`.
- The repository is a provider of its module and is **not** exported from `index.ts`.
  If a new module needs another module's data, it goes through that module's service.

## 3. Errors (ADR-07)

- Services throw `DomainError`, never Nest's `NotFoundException` / `ConflictException`
  / friends. The whole point is one catalog and one filter.
- Every new code is declared in `src/shared/errors/error-codes.ts`. It will not
  compile otherwise — that is deliberate, so if a diff adds a code, check that the
  code *earns* its place: a new code means the app reacts differently. Reusing an
  existing code where behavior is the same is the better change.
- Codes are the published contract with the app. **Renaming one is a breaking change**,
  even though nothing in this repo will fail. Flag any rename.
- Check the `ErrorKind` maps to the status the endpoint documents in Swagger, and that
  the message leaks nothing internal (no ids of other users, no SQL, no stack).

## 4. Soft delete

Every model in `schema.prisma` carries `deleted_at`, so:

- A repository `delete()` that calls `prisma.*.delete()` performs a real `DELETE`. In
  a module whose rows sync to the app, that erases the evidence the row ever existed,
  and the deletion never reaches the other devices.
- `findMany` / `findById` that do not exclude `deletedAt` will hand back deleted rows.

`UsersRepository` currently does both of these wrong. It is a known gap, not a
reason to let a new module repeat it.

## 5. Client-generated ids and offline (ADR-08, ADR-09)

The app writes without network and generates its own UUIDs, so anything accepting
records from the client needs checking for:

- **Idempotency.** The network drops mid-request and the app resends. The same record
  arriving twice must not become two rows, and must not apply a stock movement twice.
  An `upsert` on a unique key is idempotent; a `findFirst` followed by a `create` is
  not — it loses the race against two concurrent requests.
- **A client-supplied id colliding with another user's row.** The server receives ids
  it did not generate (ADR-09 says so explicitly, and flags this as the cost). Writing
  to an id that belongs to someone else must answer 404.
- **Absurd future dates.** Phone clocks are wrong, and "last write wins" breaks when a
  record claims to be from next year. ADR-08 names discarding these as the mitigation.

## 6. Schema and migrations

When `prisma/schema.prisma` changes:

- `String @id @default(uuid()) @db.Uuid` — never autoincrement.
- Every field has `@map("snake_case")`; every model has `@@map("table_name")`; every
  enum has `@@map("enum_name")`.
- A user-owned resource has `userId ... @map("user_id") @db.Uuid`, a relation to
  `User`, and an `@@index([userId, ...])`.
- Dates are `@db.Timestamptz(6)`. Deletion is `deletedAt`, not `DELETE`.
- Decimal precision is fixed by what the number *is*: **money (14,2)**,
  **quantity (14,3)**, **unit cost (14,4)**. A quantity declared `(14,2)` is a finding.

And on the migration itself:

- It is a committed file under `prisma/migrations/`, generated by Prisma. A schema
  change with no migration in the diff means the table exists on exactly one machine.
- Hand-edited migration SQL is a finding — it desyncs from what Prisma will diff next.
- A schema-altering migration ships a `down.sql` beside it, tested up-then-down
  against a disposable database.

## 7. HTTP surface

- Input validation is declarative and the global `ValidationPipe` runs with
  `whitelist` + `forbidNonWhitelisted`: a field absent from the DTO does not get
  ignored, it **400s the request**. So a new accepted field without its
  `class-validator` decorator is a bug, not a style issue.
- The response shape is the `entities/` class — that is what Swagger documents. If the
  service starts returning a new field, check the entity gained it too.
- A new module needs its `addTag(...)` in `src/main.ts`, or it is undocumented in
  `/docs`. Nothing fails without it, which is exactly why it gets forgotten.

## 8. Auth-specific checks

- Nothing outside the guard reads or parses the `Authorization` header.
- Identity attributes that Cognito owns — e-mail above all (ADR-02) — come from the
  token's claims, never from the request body. A body-supplied e-mail lets the caller
  claim to be someone else.
- Endpoints that reveal whether an account exists are a finding: sign-in failures and
  password-reset requests answer the same way for a known and an unknown e-mail.
  Sign-in, refresh and password reset happen app→Cognito directly, so this mostly
  shows up as pool configuration in `scripts/bootstrap-aws.sh`, not as endpoints.
- Anything depending on refresh-token **rotation** passes locally and fails on real
  AWS: MiniStack accepts the parameter and ignores it (ADR-12).

## 9. Language

`CLAUDE.md` requires English for new and modified code — comments, JSDoc, identifiers,
test names, schema and migration comments, commit messages. Most of the repository
predates the rule and is not being translated in bulk, so only flag Portuguese that
the diff itself **adds or edits**. The codes in `error-codes.ts` stay in Portuguese by
decision; do not flag them.

## 10. Tests

Judge whether the test would fail if the code were wrong.

- A mock that returns a fixed object proves the method was called, not that the rule
  holds. An idempotency test in particular is worthless against a mock with no state —
  it needs a fake that actually stores rows and enforces the same uniqueness the
  database does.
- Ask what input makes the rule flip, and check that case exists — not just the happy
  path.
- And the two-user isolation test from §1, which outranks all of the above.

## Reporting

Order findings by consequence, not by file. Leaked data and lost writes first;
missing tests next; everything else after. Say what breaks and under what input — a
finding a reader cannot reproduce from the description is not yet a finding.

Be willing to come back with nothing. A short review that names one real problem is
worth more than fifteen observations that a reader has to triage.
