# ADR-0003: stack and deployment boundary

**Status:** Accepted
**Date:** 2026-09-21
**Deciders:** Ta (product owner), with the planning session acting as tech lead on Ta's instruction. Recorded in the [decision register](../docs/product/decisions.md) row D04 (channel: Ta's chat answer to the W0-01 options, later session of 2026-09-21).
**Decision register:** D04
**Build plan reference:** W0-01 / W0 exit; governs W1-W3 and every later package

## Context

The review desk needs one runtime shape before W0-02 can name paths, commands and pinned dependencies and before any W1 ticket can start. BUILD_PLAN W0 asks for the simplest shape that keeps the [architecture boundaries](../docs/architecture/README.md) (identity, server authorization, workflow, store, artifacts, QC, notification, observability) as seams with test substitutes, not microservices.

Constraints that bind the choice:

- **Source-spec locks.** L2/L3/L6: the desk links to TPM, VRO and the AI Reporting Tool and never writes to them. L4: production identity is True AD on True's network. L7/L8: AI flags, humans decide; readiness is a server predicate. L11: any Google account may sign in on localhost only; a networked URL needs an allow-list or AD; production is AD only. L12: what Admin owns is versioned configuration.
- **Acceptance.** A01 (server-side scope on every read, search, download and deep link; local Google only on loopback; production rejects Google), A07 (immutable submitted versions, one successor on concurrent send-backs, idempotent replay), A09 (Ready only from current-version approvals plus dispositions; no self-approval under D05), A11 (journey reconstructable from an append-only audit trail).
- **Recorded decisions** D01-D03, D05, D06, D11, D12 and the W0-04 field rule are implemented as written; D07-D10 stay open. D12 requires every user-facing string to carry a locale key, Thai default, from the first screen.
- **Team.** 2-3 engineers plus agents under task briefs; the design handoff is a rich reviewer UI (queue, nine-slot pack editor, three parallel reviewer workspaces, version history, findings and dispositions, configuration) already browser-tested as a static export in `demo/`.
- **Host.** True hosts production (W8); the host, AD groups, backup and incident channels are D10 and unknown until then. The stack must therefore run from a plain container or VM with a relational database and a private disk, and must not assume any managed cloud service.
- **Stop condition** (BUILD_PLAN W0 exit): reject any option that assumes unrestricted network login or writes to TPM, VRO or the AI Reporting Tool.

The [W0 technical contract](../docs/delivery/w0-technical-contract.md#w0-01--stack-adr-d04) fixes the three candidate shapes and seven scoring criteria in advance so that this ADR scores with evidence, not preference.

## Options considered

### Candidate shapes

| Shape | Description | Watch for |
|---|---|---|
| **A. Small cohesive server-rendered app** | One web process renders HTML pages and enforces rules; one relational database; local blob directory behind an interface | Richness of the reviewer UI; whether it matches team skills |
| **B. SPA + API** | Separate browser app and API service in one repository | Two deployables; authorization must still live entirely in the API |
| **C. Full-stack framework** | One framework (for example Next.js, Remix, SvelteKit) handles both UI and server routes | Framework coupling of auth and data access; upgrade burden on the True host |

A fourth variant, **B1 = B with one process**, was scored as well: the API process also serves the built SPA bundle, so there is one deployable while the browser app and the server remain separate code with a typed contract between them. This is the variant chosen.

### Scoring

Scores: **3** meets the criterion with no structural risk, **2** meets it with a named mitigation, **1** meets it only with discipline that the shape does not enforce, **0** fails. Evidence cites the acceptance ID or lock the criterion serves.

| # | Criterion | A. Server-rendered | B. SPA + API (two deployables) | B1. SPA + API, one process | C. Full-stack framework |
|---|---|---|---|---|---|
| 1 | **Server-side authorization** (A01): every read, download, search and deep link checked on the server | **3.** Page and data are the same request, so a check on the route is a check on the data. | **3.** The SPA holds no authority; every read is an API call the server checks. Deep links resolve to API calls. Risk: a second deployable can drift its origin/CORS rules. | **3.** Same as B; one origin, so no CORS surface at all. The demo's client-side permissions are never ported (design-to-build map). | **2.** Server routes can check scope, but framework data-fetching conventions (server components, loaders, server actions) blur the line between "rendered on the server" and "authorized on the server"; a reviewer has to know the framework to audit it. |
| 2 | **Auth portability** (L4, L11): local Google on loopback only, allow-list or AD on a network, True AD/Entra in production, one adapter | **3.** A single OIDC adapter behind the session; mode is configuration. | **3.** Same adapter in the API; the SPA only sees a session. | **3.** Same. `openid-client` speaks Google today and Entra later through one OIDC/OAuth2 interface; modes fail closed without credentials (W0-03). | **1.** Framework auth libraries assume their own session model and providers; True AD/Entra and the loopback-only rule become adapter code fighting the framework, and the framework's auth package tracks the framework's release cadence. |
| 3 | **Transactional integrity** (A07, A09): freeze, lane decision, successor creation and Ready atomic and idempotent | **3.** One process, one Postgres transaction per event; idempotency keys are rows. | **3.** Same in the API. | **3.** Same. Drizzle exposes plain SQL transactions and forward-only migrations as an explicit step (W0-04 schema-evolution rule). | **2.** Achievable, but framework ORM/edge-runtime defaults (serverless handlers, connection pooling per request) push toward per-request connections where multi-statement transactions and `SELECT ... FOR UPDATE` need care. |
| 4 | **Document handling**: private blob store, hashing, size and type limits, safe download | **3.** Multipart upload to the process; bytes hashed and stored behind an interface; downloads stream through the same authorization. | **3.** Same in the API; the SPA uploads to an authorized endpoint. | **3.** Same. Fastify streams multipart with size limits; content sniffing and hashing happen before the blob interface accepts the bytes (W0-08). | **2.** Route handlers in full-stack frameworks are often body-size limited or edge-targeted; large uploads and streamed downloads need a Node runtime route and framework-specific escape hatches. |
| 5 | **Operational burden on the True host** (W8, D10): runtime availability, patching, backup and restore | **3.** One process plus Postgres and a disk. | **2.** Two deployables (static host and API) means two things to patch, two origins to secure and a CORS policy to keep right. | **3.** One Node process, one Postgres, one private directory. Patching is Node LTS plus `npm audit`; backup is `pg_dump` plus the blob directory (W7-00 rehearsal). | **1.** The framework's own release cadence and its preferred hosting shape (edge, serverless, vendor platform) are the upgrade burden; self-hosting a full-stack framework on a True VM is possible but goes against the framework's grain. |
| 6 | **Team skills and maintainability** for 2-3 engineers plus agents | **1.** The design is a rich, stateful reviewer UI (three parallel lanes, dialogs, live findings, version navigation) that a server-rendered page model reproduces only with a client-side layer anyway; the team would end up building B under A's name. | **3.** Plain React + a plain API is the most widely known shape; agents produce reliable code against a typed contract. | **3.** Same as B, with a shared request/response package (path assigned by W0-02) giving both halves one set of request/response shapes and error types. | **2.** Productive for people who know the framework; a moving target for agents and for a reviewer who must audit auth and data access through framework abstractions. |
| 7 | **Testability**: unit, integration and browser tests runnable locally without external services | **3.** One process, real Postgres in Docker, browser tests against it. | **2.** Two services to start for a browser test. | **3.** `node:test` for unit and for integration against the real Postgres; Playwright drives the served SPA from the same process; substitutes for identity, QC and mail are in-process. | **2.** Framework test setups (their own dev server, mocks for server components or loaders) are specific to the framework version. |
| | **Total (of 21)** | **19** | **19** | **21** | **12** |

Evidence notes:

- Criterion 6 for A is the decisive difference between A and B1. The design handoff's screens (queue with role-scoped counts, nine-slot pack editor with inline reasons, three reviewer workspaces with artifact-specific send-back, disposition dialogs, version history) are stateful client interactions; the browser-tested `demo/` already needed a component runtime to exhibit them. Server-rendered pages would need the same client layer on top, which is B1 by another name with less structure.
- Criterion 5 for B is the decisive difference between B and B1. The design has one audience on one origin, so a second deployable adds patching, CORS and origin-drift risk with no benefit.
- Criteria 1, 2, 3, 5 for C are the stated watch-fors in the W0 contract (framework coupling of auth and data access; upgrade burden on the True host) and were confirmed rather than assumed: framework auth and data-fetching conventions are the framework's, not ours, and their release cadence sets the host's patch cadence.

### Stop condition check per option

| Option | Assumes unrestricted network login? | Writes to TPM / VRO / AI Reporting Tool? |
|---|---|---|
| A | No; OIDC adapter with loopback-only Google | No; links only |
| B / B1 | No; same adapter in the API | No; links only |
| C | No, but only if the framework's default auth is replaced by the adapter | No; links only |

No option is rejected by the stop condition alone; C is rejected on criteria 2, 5 and 6.

## Decision

Accepted by Ta on 2026-09-21 (later session, chat answer to the W0-01 options), recorded as D04 in the register. **Shape B1: SPA + API in one repository and one deployable.**

- **Language and runtime.** TypeScript on Node 24.
- **Deployable.** One repository, one deployable: a **Fastify** API process that also serves the built **React + Vite** SPA from the same origin. Authorization lives entirely in the API; the SPA holds no permission logic.
- **Database.** **Postgres 16** in Docker locally and in CI. **Drizzle ORM** with **forward-only SQL migrations run as an explicit operator step**, never implicitly at start (W0-04).
- **Identity.** **openid-client**. Modes per W0-03: `local-google` on loopback only (refuses a non-loopback bind); `network` and `production` fail closed without configured credentials; production is True AD/Entra with Google off.
- **Artifacts.** Local filesystem blob store behind an interface, keyed by content hash, with metadata in Postgres (W0-04, W0-08).
- **Tests.** `node:test` for unit and integration; integration tests hit the real Postgres; **Playwright** for browser journeys against the served SPA. Substitutes for identity, QC and mail are in-process (W0-03, W0-07).
- **Layout.** Assigned by W0-02 (repository layout, paths, docker-compose location, the architecture README's "Path in repo" column). The D04 row records no layout; the proposal under "Proposed for W0-02" below is input to W0-02, not part of D04. The legacy `demo/` stays untouched as reference only (BUILD_PLAN, ADR-0002).
- **Language rule.** Every user-facing string carries a locale key (D12: bilingual, Thai default) from the first screen.

### Why B1 over A

A scores as well as B1 on every server-side criterion but loses on criterion 6: the reviewer UI the design requires is a stateful client application, and a server-rendered shape would force the team to add that client layer ad hoc. B1 keeps A's single process and single origin while giving the UI a proper home with a typed contract in a shared request/response package (path assigned by W0-02).

### Why B1 over C

C loses on criteria 2, 5 and 6: framework auth and data-access conventions couple the two things the threat model needs to be auditable in plain code (the identity adapter and the server-side scope check), and the framework's release cadence becomes the True host's upgrade burden under an unknown D10. Fastify, React and Drizzle are small, independently versioned libraries; replacing any one of them is a local change.

### Why B1 over plain B

Two deployables add a second origin, CORS rules and a second thing to patch on the True host for an application with one audience. Serving the built SPA from the API keeps one deployable (criterion 5) and one test target (criterion 7) without merging the code bases.

### Contract error codes (chosen here for W0-06)

W0-06 lists seven error types and defers the HTTP code to this ADR. The API uses these; a shared request/response package (path assigned by W0-02) holds the type definitions and every response carries a stable `code`, a locale key for the user message and the request correlation ID (W0-10).

| Error type | HTTP status | `code` | Note |
|---|---|---|---|
| Unauthenticated | 401 | `unauthenticated` | No or invalid session |
| Forbidden | 403 | `forbidden` | Authenticated but out of scope; the body never reveals whether the case exists to an out-of-scope caller beyond this code |
| Stale version | 409 | `stale_version` | Expected-version mismatch; body carries the current version reference for refresh guidance; nothing changed |
| Invalid input | 422 | `invalid_input` | Field-level messages, each with a locale key |
| Unsafe upload | 422 | `unsafe_upload` | Type sniff, size or per-pack total failed; bytes discarded; safe message only |
| QC unavailable | 503 | `qc_unavailable` | Also recorded as an `unavailable` finding with `owning_lane` (W0-07); never presented as clean |
| Mail delivery failed | 502 | `mail_delivery_failed` | Returned on the notification record, not to the actor's business action, which has already committed (W0-07) |

Not-found for an in-scope reference is 404 `not_found` (an eighth code beyond the seven W0-06 types, for W0-06 to confirm). An out-of-scope reference returns 403; note that distinguishing 403 from 404 discloses whether a case exists to an out-of-scope caller. Whether out-of-scope references should instead answer 404 to hide existence is decided in W0-05 (authorization matrix) with the threat model; until then W1 implements 403. An idempotent replay of an already-applied action returns the original success response (A07), not an error.

## Consequences

### Positive

- One process, one origin, one database, one private directory: the smallest surface for A01 checks, for W7-00 backup/restore rehearsal and for the True host under D10.
- Plain SQL transactions and an explicit migration step make A07/A09 atomicity and the W0-04 immutability and schema-evolution rules reviewable in one place.
- One OIDC adapter covers Google-on-loopback now and Entra later without a second identity code path.
- A shared request/response package (path assigned by W0-02) gives Lane A and Lane B one typed contract, which is what lets the W1-13 UI substitute and parallel lane work (contract PR → lane PRs → integration ticket) function.
- `node:test` and Playwright need no external service; CI is Node plus a Postgres container.
- Widely known, independently versioned libraries suit 2-3 engineers plus agents working from task briefs.

### Negative

- Two build steps (Vite bundle, then server) and a client/server type boundary to maintain; a schema change touches the shared package, the server and the web app.
- The SPA must be served with a strict content-security policy and the API must set no-store on authorized responses; a server-rendered page model would have had fewer client-side concerns.
- A single process means QC and mail work in-process in slice 1; if W4 model calls need isolation, a worker boundary is added then (the QC interface in W0-07 already permits it).
- Playwright browsers are a local install step (W1-12 pins the version and documents the install).

### Risks

| Risk | Mitigation | Owner |
|---|---|---|
| Authorization logic leaks into the SPA (the demo's role switcher ported as product) | Design-to-build map "simulation only" table; W1-01 replaces the role switcher; A01 negative tests call the API directly, not the UI | Lead review |
| A dependency added outside the W0-02 pinned list | W0-02 pins versions with reasons; agents may not add dependencies; CI fails on lockfile drift | W1-12 |
| Migrations run implicitly on start and rewrite immutable rows | Explicit migration command (W0-02); W0-04 forbids rewriting submitted versions, findings, dispositions and audit rows; migration tests against the fixture store | W1-00, W7-00 |
| True host cannot run Node 24 / Postgres 16 / Docker | D10 records the host; the stack needs only a Node LTS runtime, a Postgres instance and a private directory; no managed service is assumed | IT/Security at D10 |
| Non-loopback bind in `local-google` mode | Adapter refuses to start (W0-03); readiness check fails closed (W0-10); W1-01 tests it | Eng A |

## Open items

- [ ] True host runtime, Node/Postgres versions available there, backup target and incident channels — IT/Security + accountable owner, **D10** (before networked test or W8). This ADR assumes only a Node LTS runtime, a Postgres instance and a private disk.
- [ ] Production identity details (Entra tenant, AD group-to-role mapping) — W6/W8 at D10; W0-03 fixes only the configuration shape and the fail-closed rule.
- [ ] Whether W4 QC runs in-process or in a worker — W4 entry, ADR-0006 (D08, D09).
- [x] Exact pinned versions of Node, Fastify, React, Vite, Drizzle, openid-client, Playwright and Postgres image — recorded with reasons in the [W0-02 plan](../docs/engineering/implementation-plan-w1-w3.md#4-pinned-dependencies) (merged 2026-09-21); installed under W1-00 and W1-12.
- [x] Repository layout (app, tests, fixtures and config paths, docker-compose location, the architecture README's "Path in repo" column) — recorded in the [W0-02 plan](../docs/engineering/implementation-plan-w1-w3.md#1-repository-layout) (merged 2026-09-21), which accepted the proposal below.
- [x] Whether an out-of-scope reference answers 403 (current contract) or 404 to hide case existence from probing — recorded by [W0-05 section 4](../docs/engineering/authorization-policy-matrix.md#4-out-of-scope-references-403-with-non-guessable-identifiers) (403, conditioned on non-guessable identifiers; 404 only for an `all_cases` holder on an unresolvable id) and carried into [W0-06 section 8](../docs/engineering/workflow-transition-and-error-contract.md#8-error-contract), which also confirms `not_found` as the eighth code and `internal_error` as the 500 catch-all. Closed at the W0 exit review ([W0-09](../changes/2026-09-21-w0-exit/review.md), 2026-09-21).

### Proposed for W0-02 (not part of D04)

An agent proposal for the W0-02 file-level plan to accept, amend or replace; nothing here is recorded in the register or binding on a lane until W0-02 lands:

- `rai-web/server` (Lane A), `rai-web/web` (Lane B), `rai-web/shared` (request/response shapes, error types), `rai-web/fixtures` (Lane C synthetic data), `rai-web/tests`; `docker-compose.yml` at the repo root.

## Stop conditions

From BUILD_PLAN W0 exit, checked against the chosen stack:

- **No unrestricted network login.** `local-google` binds loopback only and refuses otherwise; `network` requires an allow-list or AD; `production` is True AD only with Google off; all three fail closed without credentials. Passed.
- **No external-register writes.** TPM, VRO and the AI Reporting Tool are reference links only (L3, L6); no client, credential or endpoint for any of them exists in the stack. Passed.

## References

- [Decision register](../docs/product/decisions.md) — D04 row (recorded 2026-09-21), D03 amendment, W0-04 fields
- [W0 technical contract](../docs/delivery/w0-technical-contract.md) — W0-01 candidate shapes and criteria; W0-03, W0-04, W0-06, W0-07, W0-08, W0-10 interface rules cited above
- [BUILD_PLAN](../BUILD_PLAN.md) — W0 entry/exit, build principles 3, 4, 7, 8
- [Architecture](../docs/architecture/README.md) — boundaries this stack must keep; "Path in repo" assigned by W0-02
- [Acceptance](../docs/acceptance.md) — A01, A07, A09, A11
- [Source spec](../docs/product/source-spec.md) — L2, L3, L4, L6, L7, L8, L11, L12 (frozen; hash in [sources](../docs/sources.md))
- [Threat model](../docs/security/threat-model.md)
- [Design handoff](../docs/design/DEVELOPER_HANDOFF.md) and [design-to-build map](../docs/delivery/design-to-build-map.md)
- [ADR-0002](0002-local-design-demo.md) — the synthetic demo this ADR does not promote
- [Adoption profile](../docs/engineering/adoption.md) — "Toolchain" row updated by this ADR
