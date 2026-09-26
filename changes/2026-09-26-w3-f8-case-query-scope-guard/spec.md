# Specification

## Goals

1. A new read of the `case` table in server code that neither applies `caseScopeWhere` nor has a written reason fails `npm run test:unit`.
2. The reasons for every deliberate exception are in one visible allow-list that a reviewer reads in the diff.
3. The allow-list cannot rot: an entry that no longer matches a site fails the test.
4. W0-05 "Query scope" describes the test that exists, by file name.

## What the test covers

- Every non-test TypeScript module (`.ts`, `.mts`, `.cts`, `.tsx`; not `*.test.*`, not `.d.ts`) under `rai-web/server/src`, parsed with the TypeScript compiler API (already a dev dependency), never with regular expressions over lines. Each file is bound on its own (no lib, no module resolution) so that every local name and import resolves to its declaration: shadowing, block scope and property names cannot pass for a variable.
- The **table** `T` is the schema's `cases` imported from `db/schema/{case,index}` under any local name (any `.js`/`.ts` extension), `schema.cases` of the schema namespace (`import * as`, `db/client`'s `schema`, a dynamic `import()`), a destructured `{ cases: x }` of that namespace, a `const`/`let` holding `T`, an `alias(T, …)` under any import name of `alias`, or a `pgTable('case', …)`.
- A **site** is any of:
  - a Drizzle builder call `.from(T)`, `.innerJoin(T, …)`, `.leftJoin`, `.rightJoin`, `.fullJoin`, `.join`, `.crossJoin` or a lateral join of `T`, and `.$count(T, …)`;
  - the relational API `query.cases` or `query['cases']` (whatever `query` hangs off), and `with: { case | cases }`;
  - any string or template literal (tagged with `sql` under any name, `sql.raw`, an untagged template, a plain string) whose text names the table: `"case"` quoted, or schema-qualified `x.case` / `x."case"`, anywhere (after `FROM`, `JOIN`, `ONLY`, a comma, in a fragment), or that interpolates `T` anywhere or an unknown table name after `FROM`/`JOIN`/`ONLY`/a `FROM`-list comma (a known other schema table, a column, or a `const` string that is not `case` is not one). Bare `CASE` is the SQL keyword (`case` is reserved in Postgres, so the table is always quoted or qualified), and `IS DISTINCT FROM x` / `EXTRACT(f FROM x)` are not table positions;
  - an **escape**: any other use of `T` (passed to a helper, `getTableName(T)`, a conditional, exported, re-exported with `export … from`) outside `db/schema/*` and `db/client`, because the guard cannot follow `T` there. The schema namespace handed to anything other than a member access or a local destructure is an escape too.
  Writes (`insert`, `update`, `delete` on `T`, `UPDATE`/`INSERT INTO`/`DELETE FROM` text) are not sites; nor are projections (`select({ c: T })`, `getTableColumns(T)`), column references (`T.id`) and types.
- A predicate is **conjunctive in the scope** when it is `caseScopeWhere(p)` (a named or namespace import from a `scope` module) with `p` a parameter of the enclosing code, a field of one or a `const` taken from one; an `and(…)` with such an argument (a spread counts when it is an array literal or a `const` array seeded with one and only `push`ed and spread into `and`); a `const` initialised with one; a `let` whose initialiser and every later assignment are one (reads of the `let` itself count, so `where = and(where, x)` keeps it); or a parameter of a local, unexported function whose every caller passes one. `or`, `not`, `?:`, `??`, an `sql` template around the predicate and a subquery do not count.
- A site is **scoped** when:
  - builder: every `.where(…)` on its fluent chain and on later statements over the variable holding the query is conjunctive, and at least one applies: on the chain; or, for a `$dynamic()` query held in a variable, in the first later statement of the same block that uses it (`q.where(s)` or `q = q.where(s)`); or, for a base builder returned by a local, unexported helper, on every caller's chain. An `innerJoin(T, on)` whose `on` is conjunctive is scoped too (not a left or full join);
  - `$count(T, w)`: `w` is conjunctive;
  - relational: the `findMany`/`findFirst` argument's `where` property is conjunctive (any other argument does not count);
  - literal: a drizzle `sql` template with exactly one read, no `OR`, and an interpolation of a conjunctive predicate directly after `WHERE`/`AND` and followed by the end, `AND`, `ORDER`, `GROUP`, `LIMIT`, `OFFSET`, `FOR` or `RETURNING`. Every other literal read, and every escape, is unscoped.
- Any other site must match an **allow-list** entry keyed by the repository-relative file and the name of the enclosing function (a class field's name for an arrow-function field), with an expected site count and a one-line reason. Line numbers are not used, so edits elsewhere do not break it.
- The test fails, naming file, line, function and kind, on (a) an unscoped site with no entry, (b) a site count above the entry's count, (c) an entry that matches no site or fewer sites than its count (stale).

## Known limits

Stated here and in the test file header so a reviewer knows what the guard does not prove:

- The actor passed to `caseScopeWhere` is checked to be a parameter (or a field of one) of the calling code, not that the caller passed the request's actor; a module constant or literal actor is rejected, but a caller that passes a synthetic `all_cases` actor as the parameter is not seen.
- SQL assembled so that no single literal names the table (for example `'"ca' + 'se"'`), or built by a helper in another module from pieces, is not seen. A raw template's SQL nesting is not parsed: a single read plus `WHERE|AND ${scope}` is accepted even if the read sits in a subquery the scope does not filter.
- Names are resolved within one file. A table re-exported through another module is flagged at the re-export (an escape), not traced through it.
- The allow-list is keyed by file and function name plus a count, so if an allow-listed read becomes scoped and a new unscoped read appears under another function of the same name in the same file, the new read takes the vacated slot.

## Allow-list at the start (to be confirmed by reading each site)

By-id reads after authorization: `cases/repository.ts` (single-case load and the case-view status join), `artifacts/pipeline.ts` `openDraftOf`, `notifications/service.ts`, `db/transaction.ts` (the `FOR UPDATE` lock by id). Pre-authorization facts read: `authz/facts.ts` (both reads, W0-05 Middleware "three columns"). Operator, not actor-facing: `sla/breach.ts` (SLA-breach digest), `operator/db-cleanup.ts` (stale-draft count). The implementer confirms each against the code and records anything else found.

## Self-test

The analyzer function is tested on synthetic source strings, which proves that it flags an unscoped `.from(cases)`, a join, an aliased import, an `alias(cases)` and a raw `FROM "case"`, and that it accepts the inline and the variable forms of `caseScopeWhere`. So the guard is shown to catch what it claims to catch, not just to pass on today's code.

An adversarial review (2026-09-26) probed the first analyzer with evasions and false positives; each one that reproduced has a synthetic self-test: `$count`, a table in a `const`, a destructured or dynamically imported namespace, a table passed to a helper, a re-export, `getTableName`, a second `pgTable('case')`, a destructured or element-accessed relational `query`, `with: { case }`, a relational scope outside `where`; a wrong actor, `or`, `not`, a ternary, `??`, an `sql` wrapper, an `EXISTS` subquery, block shadowing, a property named like the scope variable, a replacing second `where`; `sql.raw`, plain strings, concatenation, a schema-qualified or comma-joined table, `FROM ONLY`, fragments, `sql.identifier('case')`, a table-name helper, a renamed `sql` tag, a two-read template with one scope, a scope interpolated as a value; and the scoped shapes it must accept (an `and()` const, a conditions array, inner-join `ON`, `$dynamic` with a later `where`, a namespace import of the scope module, a base-builder helper, a `let` extended with `and`, a scope parameter, a scoped `sql` template) together with their leaking variants. The CASE keyword (`EXTRACT(EPOCH FROM CASE …)`, `IS DISTINCT FROM CASE …`) is not a read, `.mts`/`.tsx` files are read, and a class field is named by its field.

## Done when

The goals hold, the full suite is green serially on a dedicated Postgres, W0-05 names the test and the "Query scope" paragraph matches the behaviour, and there is no product behaviour change.
