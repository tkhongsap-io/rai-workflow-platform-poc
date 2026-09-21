# Plan: W1-01 — local sign-in, fixture identity provider, authorization middleware

2026-09-21. Ticket W1-01 (issue #17), lane A, owner type HRR. Branch `codex/w1-01-identity-sign-in`, worktree `/Users/tkhongsap/github/rai-wt/W1-01`, Postgres `rai-w1-01` on port 54321. Recorded before code.

## Intent

Prove A01 (local) on the real server: each fixture user, the dual-role identity included, signs in through the fixture identity provider and receives its (role, scope) pairs; a request without a session is unauthenticated; a wrong-role request is forbidden; `local-google` refuses to start on a non-loopback bind and on an unknown mode. Implement everything W0-03 assigns to W1-01 (sections 4.1, 4.4, 5, 6; tests ID-01 to ID-03, ID-05 to ID-11, ID-18, ID-19) and the W0-05 middleware as the single enforcement point. No decision is made; D07-D10 stay open; the source spec is untouched.

## Spec

- [W0-03 identity adapter](../../docs/engineering/identity-adapter.md): interface (section 2), modes (3), verifiers and resolvers (4), start-up refusal table S1-S18 (5), routes, session and error contract (6), fixture provider (7), secrets (8), configuration (9), audit hooks (10), tests (11).
- [W0-05 authorization matrix](../../docs/engineering/authorization-policy-matrix.md) section 6 "Middleware (W1-01, Fastify)" and section 4 (403 with non-guessable ids; 404 only for an `all_cases` holder).
- [W0-02 plan](../../docs/engineering/implementation-plan-w1-w3.md) sections 1 (paths), 5 (variables), 7.1-7.2 (shapes and routes).
- [W0-04](../../docs/engineering/persistence-and-artifact-store.md) database roles for the new `session` table's grants; audit action names `identity.*`.

## Plan

1. `session` table: Drizzle schema, migration `0001_w1_01_session.sql` (drizzle-kit output completed by hand with checks and grants: rai_app SELECT/INSERT/UPDATE, rai_operator DELETE).
2. `server/src/secrets/index.ts`: `SecretSource` (`env`, `file`), S15 placeholder rule.
3. `server/src/identity/`: `types.ts` (interfaces, reason codes, `SignInRefused`, `IdentityStartupError`), `config.ts` (pure `parseIdentityConfig(env, bind)`, S1-S10, S13-S15, S17), `allow-list.ts` (4.2 shape and resolver), `group-mapping.ts` (9.2 shape and 4.3 resolver), `oidc.ts` (openid-client v6 verifier with injectable exchange), `adapter.ts` (`createIdentityAdapter({ env, discovery, groupMappingSource, ... })`, S11/S12/S16/S18 inside `start()`), `session.ts` (Postgres store, cookie names, audit events, sweep), `routes.ts` (the W0-02 7.2 routes).
4. `server/src/authz/middleware.ts` + `facts.ts`: route `config.auth` declarations, `onRoute` guard, session in `onRequest` (401 first), policy in `preValidation` (403 before 422), one helper for facts → authorize → 404.
5. `app.ts` wires cookie, middleware and routes; `start.ts` + `main.ts` run start() before listen and the S16 check after; `db-cleanup` sweeps sessions.
6. Tests first where the clause is testable: ID-01 table (unit), ID-02 (real listen, stubbed address), ID-03/ID-08/ID-09/ID-10 (integration on Postgres and a real process spawn), ID-05/06/07/18/19 (unit), ID-11 (inject with in-memory store), middleware table (unit).
7. Docs: TESTING.md, this folder's review.md.
