# Specification

## Goals

1. A new read of the `case` table in server code that neither applies `caseScopeWhere` nor has a written reason fails `npm run test:unit`.
2. The reasons for every deliberate exception are in one visible allow-list that a reviewer reads in the diff.
3. The allow-list cannot rot: an entry that no longer matches a site fails the test.
4. W0-05 "Query scope" describes the test that exists, by file name.

## What the test covers

- Every non-test `.ts` file under `rai-web/server/src`, parsed with the TypeScript compiler API (already a dev dependency), never with regular expressions over lines.
- A **site** is any of:
  - a Drizzle builder call `.from(X)`, `.innerJoin(X, …)`, `.leftJoin(X, …)`, `.rightJoin(X, …)`, `.fullJoin(X, …)` or `.join(X, …)`, where `X` is the `cases` table imported from the schema, under any local import name, or an `alias(cases, …)` of it;
  - the relational API `….query.cases.…`, should any appear;
  - a `sql` tagged template whose literal text reads the table: `FROM "case"`, `JOIN "case"`, with or without quotes and in any case.
  Writes (`insert`, `update`, `delete`) are out of scope: none are list, search or count reads.
- A site is **scoped** when its query chain's `.where(…)` argument contains a `caseScopeWhere(…)` call, or an identifier whose initializer in the same function is a `caseScopeWhere(…)` call.
- Any other site must match an **allow-list** entry keyed by the repository-relative file and the name of the enclosing function, with an expected site count and a one-line reason. Line numbers are not used, so edits elsewhere do not break it.
- The test fails, naming file, line and function, on (a) an unscoped site with no entry, (b) a site count above the entry's count, (c) an entry that matches no site or fewer sites than its count (stale).

## Allow-list at the start (to be confirmed by reading each site)

By-id reads after authorization: `cases/repository.ts` (single-case load and the case-view status join), `artifacts/pipeline.ts` `openDraftOf`, `notifications/service.ts`, `db/transaction.ts` (the `FOR UPDATE` lock by id). Pre-authorization facts read: `authz/facts.ts` (both reads, W0-05 Middleware "three columns"). Operator, not actor-facing: `sla/breach.ts` (SLA-breach digest), `operator/db-cleanup.ts` (stale-draft count). The implementer confirms each against the code and records anything else found.

## Self-test

The analyzer function is tested on synthetic source strings, which proves that it flags an unscoped `.from(cases)`, a join, an aliased import, an `alias(cases)` and a raw `FROM "case"`, and that it accepts the inline and the variable forms of `caseScopeWhere`. So the guard is shown to catch what it claims to catch, not just to pass on today's code.

## Done when

The goals hold, the full suite is green serially on a dedicated Postgres, W0-05 names the test and the "Query scope" paragraph matches the behaviour, and there is no product behaviour change.
