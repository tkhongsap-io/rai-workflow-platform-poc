# Plan

1. Board claim on the Lane A stream; issue #180; breakdown row W3-F8; register item 13. (Done before code.)
2. Add `rai-web/server/src/cases/scope-guard.test.ts` (runs in `npm run test:unit`, needs no database): an analyzer over the TypeScript AST, the self-tests on synthetic sources, then the real run over `server/src` against the allow-list.
3. Read every site the analyzer reports and write the allow-list with a reason for each; no product code changes. If a site turns out to be actor-facing and unscoped, stop and report it (that would be a bug and a separate ticket).
4. Mutation check by hand: add a temporary unscoped `.from(cases)` in an actor-facing file, confirm the test fails with a useful message, then revert.
5. W0-05 "Query scope": replace the second bullet with what the test does and its file name; cross-check W0-04 Interfaces.
6. Full suite serially on Postgres `rai-w3-f8` port 54500 (TESTING.md): lint, typecheck, unit, integration, build plus substitute-absent, both browser suites, link check. Record the commands and outputs in `review.md`.
7. PR on `codex/w3-f8-case-query-scope-guard`; two independent reviewer agents (contract and test-quality); CI green on the reviewed head; merge through the D03 ticket flow.
