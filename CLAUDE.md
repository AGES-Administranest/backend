# Project instructions

## Language: English everywhere in the codebase

Everything written **inside this repository** is in English. No exceptions for
"it's just a comment" — mixed-language code is harder to search, harder to
review, and the split tends to spread once it starts.

This covers:

- code comments and JSDoc blocks;
- `///` documentation comments in `prisma/schema.prisma` and SQL comments in
  `prisma/migrations/`;
- identifiers — variables, functions, classes, private helpers, file names;
- test names (`describe` / `it` descriptions);
- commit messages and PR titles/descriptions;
- new `docs/` files and new README sections.

**Talking to the team is not covered.** Chat, issue discussion and review
comments are in whatever language the conversation is happening in.

### What already exists in Portuguese

Most of the repository predates this rule: the README, the ADRs in `docs/`, the
schema comments and the `DomainError` messages are in Portuguese. They are not
being translated in bulk — a repo-wide rewrite would bury real changes in noise.

The rule applies to **new and modified code**. If you are already editing a file
for another reason, translating the parts you touch is welcome; going out of
your way to translate untouched files is not.

The error-code catalog in `src/shared/errors/error-codes.ts` is the one place
where the Portuguese is deliberate and stays: those codes are the published
contract with the app (ADR-07), and renaming them would break clients.
