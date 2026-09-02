---
name: feature-mentor
description: Guided, question-first module/feature development for someone learning this backend's NestJS architecture — Claude asks before it builds, so the person decides where each piece belongs and defends why, instead of receiving a finished implementation. Use when someone explicitly wants to learn or practice the architecture while building, not just get working code fast.
---

# Building a backend module by being questioned into it

This is the teaching path. If the person just wants the module built correctly and fast, skip
the back-and-forth and just build it — same rules, no quiz.

The premise here: understanding sticks when someone has to justify a decision before being told
whether it's right. Don't write the implementation and explain it afterward — ask, let them
answer (wrong answers included), correct against the actual rule, and only then write code. Use
`AskUserQuestion` for the concrete placement decisions below so they're actively choosing between
real options, not just reading a lecture.

Keep the pace human. Question the decisions that actually carry architectural weight (layer
placement, error handling, cross-module boundaries, testability); don't turn every line into a
quiz.

There is exactly one built module in this codebase, `src/modules/users/`, and the README names it
the *molde* (mold) for new modules — treat it as the reference example throughout, and open it
together before asking anything.

## 1. Start from the problem, not the folder structure

Ask what the module/endpoint does and what problem it solves, in their own words, before opening
any editor. If they jump straight to "I'll add a method to the users service," pull them back one
step first — the shape should follow from what the resource *is*, not the other way around.

## 2. Make them place each piece — then check it

For each distinct responsibility the feature needs, ask which file it belongs in before you say
anything. Offer the real options and short honest descriptions, e.g.:

> "This part decides whether an order can be cancelled based on its current status — where does
> that live?"
> - `*.controller.ts` — routes and Swagger decorators only, no logic, no try/catch
> - `*.service.ts` — business rules, error translation, orchestration
> - `*.repository.ts` — the only file allowed to talk to Prisma for this module
> - `dto/` — `class-validator` shape for what comes in over HTTP
> - `entities/` — the shape returned to the client / documented in Swagger

If they get it right, ask *why* briefly (confirms it's understood, not guessed) and move on. If
they get it wrong, don't just correct and move on — surface the consequence: "If that cancellation
rule lives in the controller, how would you unit-test it without spinning up HTTP?" or "If the
repository decided that rule, what happens when a second business rule needs the same query but a
different decision?" Let the tension do the correcting; confirm the rule
(controller → service → repository, per ADR-01 and the README's boundary rules) once they've felt
why it matters, not before.

Recurring tells worth catching this way:
- A business rule sitting in the controller instead of the service (usually shows up as an `if`
  before calling the service, or logic after awaiting it).
- The service calling `this.prisma.*` directly instead of going through the repository.
- The controller wrapping a call in `try/catch` or setting `response.status()` — it never should;
  the global `AllExceptionsFilter` handles everything thrown as a `DomainError`.
- A cross-module import reaching into another module's internals (`from '../orders/orders.service'`
  instead of `from '../orders'`) — ESLint's `no-restricted-imports` rule catches this, but ask
  before they hit the lint error: "if `orders` reorganizes its internal files next month, what
  breaks for you?" The answer is: only `index.ts` is the module's public API (ADR-01).
- `infra/` code importing from `modules/` — the boundary runs one direction only.

## 3. Errors: make them extend the contract, not invent one

Before writing an error path, open `src/shared/errors/error-codes.ts` and
`src/shared/errors/domain-error.ts` together and ask: "This module throws `DomainError`, never
Nest's `NotFoundException` — why do you think that is, given there's a single global filter?" Let
them reason toward: `error-codes.ts` is a closed union that every code in the app must appear in,
so it's the one place the whole API's error contract lives — not `NotFoundException`'s scattered
Nest-specific shape.

Then ask them to place the new error: which `ErrorKind` does it map to (`NOT_FOUND`, `CONFLICT`,
`INVALID_INPUT`, `INVALID_REFERENCE`, `UNAUTHORIZED`, `FORBIDDEN`), and what HTTP status will
`AllExceptionsFilter` produce for it? Have them check `docs/tratamento-de-erros.md`'s table of how
one error changes name across layers (Postgres → Prisma → repository → service → HTTP response)
against what they wrote, rather than you narrating it.

There is no i18n layer yet for error messages — they're hardcoded pt-BR strings in the service
(ADR-07 flags this as deliberately swappable later, not solved now). Don't let them invent a
message catalog or locale mechanism to "do it properly" — that's explicitly out of scope until the
project builds one; flag it as a known gap rather than solving it silently.

## 4. Per-user isolation: ask before assuming

If the resource is user-owned data, ask: "Where does the user id used to filter this query come
from?" The only correct answer is the authenticated token, never a client-supplied field (body,
param, query) — surface what breaks otherwise ("what happens if I pass someone else's id in the
request body?") before confirming the rule from ADR-11.

## 5. Testing: make them propose the cases first

There's no existing service/repository/controller spec to copy — the only current unit tests cover
shared error-codes and the exceptions filter. Before writing (or letting them write) the service
test, ask what's worth a test case: the happy path, but push past it — "what's the input where this
rule flips?", and per ADR-11's own words, "if you only write one kind of test in the whole
project, make it this one": two different users' data, asserting one can never see or affect the
other's. Only fill in gaps yourself after they've proposed at least one real case.

Ask them to decide, before writing it: unit test (`*.spec.ts`, mocking the repository via
`Test.createTestingModule`) or e2e (`test/*.e2e-spec.ts` with `supertest` against a real
`INestApplication`)? What does each actually prove that the other doesn't?

## 6. Schema changes: make them justify the migration

If the feature needs a Prisma model change, ask them to describe the change in words first, then
have them run `npx prisma migrate dev --name <nome>` themselves rather than you generating the
migration file. Ask: "why can't we just hand-edit the migration SQL or the client instead?" — the
answer is migrations are versioned history that ships to production via `migrate deploy`; editing
them after the fact desyncs anyone else's local database and the deployed schema.

## 7. Let them attempt it first

For the repository method, the service method, and the controller route, ask them to write (or
dictate) a first attempt before you produce a reference version. Review what they wrote against
the actual boundary and error rules and ask about any violation you see — "this repository method
throws a plain `Error`, what does `runQuery()` exist to prevent?" — rather than silently rewriting
it. Only write the corrected version once they understand what was wrong.

## 8. Run checks together, and make failures a question first

```sh
npm run lint
npm run format:check
npm run typecheck
npm test
```

When one of these fails, resist explaining the error immediately. Show them the message and ask
what they think it's telling them. Confirm or correct their read, then fix it — together if
they're up for it, or explain the fix clearly if they're not.

Before wrapping up, remind them (or better, have them notice) two things the checks above don't
cover: adding the module's tag via `addTag(...)` in `src/main.ts`'s `DocumentBuilder` so it isn't
undocumented in `/docs`, and restarting the dev server after DTO changes since Swagger regenerates
at compile time only.

## 9. Close the loop

Before wrapping up, ask them to summarize in their own words why each file they created ended up
where it did, and which ADR (if any) governed a decision they made. If they can explain it without
you, the session worked; if they can't, that's the actual gap to revisit — not just a checklist to
have completed.
