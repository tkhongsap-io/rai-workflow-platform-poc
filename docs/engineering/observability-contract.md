# Observability contract for the desk runtime (W0-10)

Status: **W0 specification, agent-drafted, human review pending.** Ticket W0-10 (issue #15), lane Lead. Depends on [W0-01](../../adr/0003-stack-and-deployment-boundary.md) (ADR-0003, D04) and the [W0-06 workflow and error contract](../delivery/w0-technical-contract.md#w0-06--workflow-transition-and-error-contract). Consumed by **W3-07** (local observability baseline), **W7** (operator rehearsal, W7-00 restore rehearsal, W6 operator guide) and **W8** (True-side monitoring integration). Nothing in this document is implemented; the first code arrives with W1-00 under the [W0-02 file-level plan](../delivery/w0-technical-contract.md#w0-02--file-level-implementation-plan).

This is the health of the **review-desk process itself**: can the process serve, can it reach its store, did its mail go out, did its QC substitute answer, did the SLA digest run, and can every failure be traced back to one request. It is **not** monitoring of any AI use case. It adds no monitoring or health field to a case (source spec: "No monitoring/health fields in v1"), it does not touch L2/L3 (the desk never writes to TPM, VRO or the AI Reporting Tool), and it never turns a log line or a health check into approval authority (L7/L8: AI flags, humans decide).

## 1. Scope and boundaries

| In scope (W0-10 → W3-07) | Out of scope |
|---|---|
| One correlation ID per request, written to the log, the audit event, the notification record and the QC run | Distributed tracing across other systems; there are none (L3, L6) |
| Structured JSON event log on stdout with a fixed field allow-list and a redaction rule | Log shipping, retention and alerting: **W8** under D10 |
| Liveness and readiness endpoints that fail closed on identity misconfiguration | Any dependency on a managed monitoring service (ADR-0003 host constraint) |
| Error capture categorised by the seven W0-06 error types | New error types or codes: W0-06 owns the list, ADR-0003 assigned the HTTP codes |
| Minimal operator view: failed mail, unavailable QC runs, SLA-breach digest generation | Automatic escalation, paging or self-healing; the operator reads and acts (D06, workflow "no automatic SLA escalation") |
| Test substitutes and the W3-07 test list | AI-use-case monitoring, model quality dashboards, registry health fields |

Stack-neutral intent, made concrete for the recorded stack: **Fastify** (its built-in `pino` logger, no additional logging dependency), **Drizzle/Postgres** (correlation-ID columns, operator queries), **openid-client** modes from W0-03, **node:test** and **Playwright**. A later stack change under a new decision keeps sections 2-6 as written and re-maps section 7.

### Interfaces this spec defines

| Interface | Where (W0-02 layout) | Owner lane | Consumers |
|---|---|---|---|
| `RequestContext` with `correlationId` | `rai-web/server/src/observability/context.ts` | A | Every server module that writes audit, notification or QC rows (W1-05, W2-02, W2-05, W2-06, W3-03, W3-04) |
| `log(event, fields)` and the event catalogue | `rai-web/server/src/observability/log.ts` | A | All server modules; W3-07 |
| Redaction rule and `assertNoLeak` test helper | `rai-web/server/src/observability/redact.ts`, `rai-web/tests/helpers/log-capture.ts` | A (helper: C) | Every integration test; W1-12 CI |
| `computeReadiness(config, probes)` and `GET /healthz`, `GET /readyz` | `rai-web/server/src/observability/health.ts`, `rai-web/server/src/routes/health.ts` | A | Startup gate; W3-07; W7 operator guide; W8 |
| `captureError(err, ctx)` and the category map | `rai-web/server/src/observability/errors.ts` | A | Fastify error handler (W1-00); every route |
| `DeskHealthReport` and `GET /api/operator/desk-health` | `rai-web/shared/src/operator.ts` (shape), `rai-web/server/src/routes/operator.ts` | A (shape shared with B) | W3-07 API and page; W6 operator guide |
| Operator page `/operator/desk-health` | `rai-web/web/src/pages/operator/DeskHealth.tsx` | B (or A under W3-07, see §7.4) | W3-07, W7 |

Paths follow the `rai-web/*` layout ADR-0003 proposed for W0-02; if W0-02 assigns different paths, W0-02's paths win and this table is corrected in the same PR.

## 2. Correlation ID

### 2.1 Rule

Every unit of work has exactly one correlation ID. For an HTTP request it is minted when the request enters Fastify. Every row the request commits that the data contract lists with a correlation field, and every row this spec adds one to, carries **that same value**: the **audit event** (data contract: "Actor, action, target version, correlation ID, time..."), the **notification record** created by the committed event, and the **QC run** the request triggered. Every log line emitted while handling the request carries it. Every error response carries it (ADR-0003: "every response carries a stable `code`, a locale key for the user message and the request correlation ID").

The value is opaque: a UUID v4 from `node:crypto` `randomUUID()`. It encodes nothing about the actor, case or time.

### 2.2 Where it is minted and how it flows

| Unit of work | Minted by | Propagated through | Written to |
|---|---|---|---|
| HTTP request | Fastify `genReqId` option; the request's `id` **is** the correlation ID | `AsyncLocalStorage<RequestContext>` started in an `onRequest` hook, so repositories and services never take it as a parameter by hand | Log lines, audit event, notification records, QC run, error body, `X-Request-Id` response header |
| Notification delivery attempt (W3-04 retry with backoff) | Not minted: reuses the notification record's `correlation_id` (the request that committed the event) | Job context carries `correlationId` plus `attempt` (1-4: first send plus three retries, D06) | Log lines for the attempt; the notification record's delivery status update |
| SLA-breach digest run (W3-03/W3-05, daily, scheduled) | The scheduler mints one per run | Job context | Log lines, the `operator_job_run` row (§7.3), the notification records the digest creates |
| QC run started in-process by a request (W1-10 substitute, W2-05) | Not minted: the request's | Passed into the QC boundary call as part of the version reference envelope, never inside the artifact bytes | The QC run row; findings inherit through the run |
| Startup, readiness probe, migration command | Process-level ID minted at boot (`processId`, also a UUID) | Log lines only | Nothing persisted |

A client-supplied `X-Request-Id` is **never trusted**: it is not read. The server-minted ID is returned in the `X-Request-Id` response header so a reviewer can quote it to the operator, and it appears in error bodies as `correlationId`.

### 2.3 Type shapes

```ts
// rai-web/server/src/observability/context.ts
export type CorrelationId = string; // UUID v4, server-minted, opaque

export interface RequestContext {
  correlationId: CorrelationId;
  startedAt: number;                 // performance.now() for durationMs
  route?: string;                    // Fastify route pattern, e.g. "/api/cases/:caseId", never the raw URL
  actor?: { subjectId: string; roles: ReadonlyArray<string> }; // opaque subject ID only; never email or display name
}

export function currentContext(): RequestContext;          // throws OBS_NO_CONTEXT outside a request or job
export function runWithContext<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T>;
```

Repository insert helpers for the three rows take `correlationId` as a **required** field (a compile error if omitted), and the columns are `correlation_id uuid NOT NULL` (schema owned by W0-04/W1-00; this spec states the column contract). Audit rows remain append-only (W0-04); the correlation ID is part of the row, never updated afterwards.

### 2.4 Same-transaction rule

The audit event, the notification record(s) and, where a QC run is triggered, the QC run row are written in the **same Postgres transaction** as the state change (W0-04 "Audit log"; W3-03 "Notifications emitted only after a committed event"). The correlation ID therefore either appears on all of them or on none: a rolled-back transition leaves no row and no notification with that ID, only the log line saying the request failed.

## 3. Structured event logging

### 3.1 Transport and format

One JSON object per line on **stdout**, produced by Fastify's `pino` instance (`fastify({ logger })`), no file rotation inside the process. The True host or the local operator captures stdout (W8 decides the collector under D10; W7 runs on a local terminal or a compose log). `LOG_LEVEL` defaults to `info`; `debug` is a local developer setting and **does not** bypass redaction (§4). A pretty printer is allowed only in `npm run dev`, never in test or CI, so the test capture always sees the JSON form.

### 3.2 Line schema

Every line has exactly these top-level keys, plus the event-specific fields listed in the catalogue. Unknown keys are dropped by the emitter (allow-list, §4.2), so a module cannot add a field without registering it here.

```ts
// rai-web/server/src/observability/log.ts
export interface LogLine {
  time: string;              // ISO 8601 UTC; render in Asia/Bangkok only in the UI (D06)
  level: 'debug' | 'info' | 'warn' | 'error';
  event: EventName;          // stable dotted name from the catalogue below
  correlationId: CorrelationId | null;   // null only for process-level lines, which then carry processId
  processId: string;
  fields: EventFields[EventName];        // per-event allow-listed fields
}
```

### 3.3 Event catalogue

Names are stable identifiers: W8 alert rules and the W3-07 tests match on them, so renaming one is a contract change (own PR, consumers updated). Fields are the **only** fields permitted for that event.

| Event | Level | Fields | Emitted by |
|---|---|---|---|
| `process.started` | info | `identityMode`, `bindAddress` (loopback or not, as a boolean `loopback`), `schemaVersion`, `commit` | W1-00 startup |
| `process.refused` | error | `reason` (§5.4 reason code) | Startup gate when readiness fails closed |
| `process.stopping` | info | `signal` | Shutdown hook |
| `request.completed` | info (`warn` for 4xx forbidden/unsafe, `error` for 5xx) | `method`, `route`, `status`, `durationMs`, `actorSubjectId?`, `actorRole?`, `errorCode?` | Fastify `onResponse` hook; one line per request, no separate "request started" line |
| `auth.signin.succeeded` | info | `identityMode`, `actorSubjectId`, `roles` | W1-01 |
| `auth.signin.failed` | warn | `identityMode`, `reason` (`provider_error` / `not_allow_listed` / `state_mismatch` / `mode_refuses_provider`) | W1-01 |
| `authz.denied` | warn | `action`, `targetType`, `targetId?`, `actorSubjectId`, `actorRole` | W1-01 policy module; also the source of the `forbidden` capture |
| `workflow.transition` | info | `caseId`, `fromVersionId?`, `toVersionId?`, `transition` (create/save_draft/submit/approve/send_back/resubmit/disposition/ready), `lane?`, `auditEventId` | W1-05, W2-02, W2-05, W2-06 |
| `workflow.stale_version` | info | `caseId`, `expectedVersionId`, `currentVersionId` | W2-02 expected-version check |
| `workflow.idempotent_replay` | info | `caseId`, `idempotencyKeyHash` (SHA-256 of the key; the key itself may be client-chosen) | A07 replay |
| `upload.rejected` | warn | `caseId`, `slot`, `reason` (`type_sniff` / `size` / `pack_total` / `extension_mismatch`), `sniffedMediaType?`, `declaredMediaType?`, `sizeBytes` | W1-03 with W0-08 |
| `upload.stored` | info | `caseId`, `slot`, `artifactId`, `contentHash`, `sizeBytes`, `mediaType` | W1-03 |
| `qc.run.started` | info | `qcRunId`, `caseId`, `versionId`, `trigger` (artifact/pack/lane), `qcKind` (`substitute` in slice 1) | W1-10, W2-05 |
| `qc.run.completed` | info | `qcRunId`, `findingCount`, `durationMs` | W1-10, W2-05 |
| `qc.run.unavailable` | error | `qcRunId`, `caseId`, `versionId`, `reason` (`timeout` / `error` / `disabled`), `owningLane` | W1-10, W2-05; the `qc_unavailable` capture |
| `mail.enqueued` | info | `notificationId`, `eventType` (lane_open/send_back/ready/sla_breach), `caseId?`, `versionId?`, `lane?`, `recipientCount` | W3-03 |
| `mail.deduplicated` | info | `eventType`, `caseId?`, `versionId?`, `lane?`, `existingNotificationId` | W3-04 |
| `mail.sent` | info | `notificationId`, `attempt`, `sinkKind` | W3-04 |
| `mail.attempt_failed` | warn | `notificationId`, `attempt` (1-3; a retry follows), `nextAttemptAt`, `errorCode` (sink's code, not its message) | W3-04 |
| `mail.failed` | error | `notificationId`, `attempts` (4: the first send plus three retries, D06), `errorCode` | W3-04 when the last retry fails; the `mail_delivery_failed` capture |
| `sla.digest.completed` | info | `jobRunId`, `breachCount`, `notificationIds` | W3-03/W3-05 |
| `sla.digest.failed` | error | `jobRunId`, `stage` (`query` / `render` / `enqueue`), `errorCode` | W3-03/W3-05 |
| `health.readiness` | info on change, `warn` when not ready | `status` and the full §5.3 report (it contains only enumerated codes, so nothing is removed) | Readiness endpoint and the startup gate; emitted only when the status changes, not on every probe |
| `error.captured` | per §6.1 | `category`, `code`, `httpStatus`, `route?`, `stackHash?`, `stack?` (internal only) | Error handler |

Fields named `*Id` are desk-local identifiers (UUIDs or the `registry_id`), never external register IDs with meaning outside the desk and never a `source_record_id` typed by a user. `caseId` is the desk-local case ID, not the use-case name.

### 3.4 What is deliberately not an event

No line for "request started" (one line per request keeps volume flat), no per-query database logging (Drizzle's logger stays off outside `debug`), no line per SPA asset served (static routes are excluded from `request.completed`), no line for successful `GET /healthz` (liveness polls would dominate the log).

## 4. Redaction rule

Derived from the [threat model](../security/threat-model.md) row "Credentials/PII in prompt, logs or email: no secrets in prompts; minimized protected logs; deep links instead of attachment contents".

### 4.1 Never in a log line

| Class | Examples | Where it would have leaked | Rule |
|---|---|---|---|
| Document contents | Artifact bytes, extracted text, QC evidence excerpts, finding messages that quote the document | QC run logs, upload errors, exception messages from parsers | Log `contentHash`, `sizeBytes`, `mediaType`, `slot`, `evidenceLocation` as a page/offset reference; never text |
| Personal data | Email addresses, display names, `business_owner`, `technical_owner`, uploader name, notification recipients, filenames (a Thai or English filename can name a person) | Sign-in, mail, upload, search | Log `actorSubjectId` (opaque provider subject), `recipientCount`, `notificationId`, `artifactId`; never the value |
| Tokens and credentials | Session cookies, OIDC `code`, `state`, `id_token`, `access_token`, client secrets, database URL, SMTP credentials | Request logs, error stacks from `openid-client`, config dumps | Headers, cookies and bodies are never logged; config is logged as mode/booleans only; `openid-client` errors are wrapped before capture (§6.2) |
| Deep-link secrets | The notification's case link and any signed query parameter | Mail logs | Log `caseId` and `versionId`; the link exists only on the notification record |
| User-typed free text | Search terms (W3-01, may contain a person's name), feedback text, N/A reasons, disposition reasons, use-case names | Request logs with query strings, validation errors echoing input | Query strings and bodies are never logged; `invalid_input` logs field **paths**, never values |
| Raw URLs | `/api/cases?search=...` | Request logs | `route` is the Fastify route pattern; path params are IDs, which are allowed |

### 4.2 Mechanism (two layers, both required)

1. **Allow-list emitter.** `log(event, fields)` copies only the keys the catalogue registers for that event; anything else is dropped and, in test and CI, throws `OBS_UNREGISTERED_FIELD` so the offending call fails the suite rather than the redaction silently doing its job. This is the primary control: a new field cannot reach stdout without an entry in §3.3.
2. **Pino `redact` as a backstop** on the Fastify logger for the paths Fastify itself would serialize: `req.headers.authorization`, `req.headers.cookie`, `req.headers["x-forwarded-for"]`, `res.headers["set-cookie"]`, `err.config`, `*.access_token`, `*.id_token`, `*.refresh_token`, `*.client_secret`, `*.password`. Fastify's default request/response serializers are replaced so that `req` logs only `method` and `routeOptions.url` (the pattern), and `res` only `statusCode`.

Error objects go through `captureError` (§6) before any logger call; a raw `err` is never passed to pino.

### 4.3 Fixture canaries and the leak test

The W0-08 synthetic fixture set gives the redaction rule something to catch. Every fixture document contains the literal `RAI-FIXTURE-CANARY-<slot>-<n>` inside its bytes; every fixture identity has a distinctive display name and email (for example `reviewer.dpo@fixture.invalid`); the fixture set includes one Thai-named file (W0-08) and one synthetic operator recipient. The test helper:

```ts
// rai-web/tests/helpers/log-capture.ts
export interface LogCapture { lines: LogLine[]; clear(): void }
export function captureLogs(app: FastifyInstance): LogCapture;            // pino destination → array
export function assertNoLeak(capture: LogCapture, forbidden: ReadonlyArray<string | RegExp>): void;
export const FIXTURE_FORBIDDEN: ReadonlyArray<string | RegExp>;           // canaries, fixture emails/names, Thai fixture filename, /RAI-FIXTURE-CANARY/, /Bearer /, /eyJ[A-Za-z0-9_-]{10,}/ (JWT-shaped), /session=/, /code=/, /state=/
```

`assertNoLeak(capture, FIXTURE_FORBIDDEN)` runs in the `after` hook of **every** integration and browser test file (W1-12 wires it), not only in W3-07. A leak anywhere in the suite fails the build.

## 5. Liveness and readiness

### 5.1 Endpoints

| Endpoint | Purpose | Touches | Status codes | Auth |
|---|---|---|---|---|
| `GET /healthz` | Liveness: the process is up and the event loop answers | Nothing (no DB, no disk) | 200 `{ status: "alive", processId }`; a hung process simply does not answer | None; not logged |
| `GET /readyz` | Readiness: the process may serve business traffic | DB `SELECT 1`, migrations journal, blob directory, mail sink, QC substitute, identity configuration | 200 `ReadinessReport` when `status: "ready"`; 503 `ReadinessReport` when `not_ready` | None; the body contains only enumerated status codes (§5.3), never hostnames, ports, paths, connection strings or error messages |

Both are served by the same Fastify process on the same origin, registered before the identity and authorization plugins so they answer even when identity is misconfigured. Network exposure of `/readyz` beyond loopback is a W8 decision under D10; the body is safe either way.

### 5.2 Fail-closed rule

Readiness **fails closed** on identity misconfiguration at two levels, both driven by one pure function so they cannot disagree:

1. **Startup gate.** `main()` calls `computeReadiness(config, probes)` before `listen()`. If `identity.status !== "ok"`, the process logs `process.refused` with the reason code and exits non-zero. It never binds. This is the W0-03 rule ("`local-google` is loopback only and refuses to start on a non-loopback bind"; `network`/`production` "refuse to start if [credentials] are absent") stated once, here, as the readiness function.
2. **Runtime endpoint.** `GET /readyz` re-runs the same function. Identity is evaluated from the immutable startup configuration (there is no config reload), so at runtime it can only report the store, mail and QC probes changing; if a future ticket adds reload, the endpoint already refuses.

`not_ready` for a **store or mail** reason does not stop the process; it reports 503 so the operator and the W8 collector see it, while the business routes return the matching contract error (`qc_unavailable`, `mail_delivery_failed`) or a 503 from the database layer. Liveness stays 200 during a database outage on purpose: restarting the process does not fix Postgres.

### 5.3 Report shape

```ts
// rai-web/shared/src/operator.ts
export type IdentityMode = 'local-google' | 'network' | 'production';     // W0-03 owns the enum

export interface ReadinessReport {
  status: 'ready' | 'not_ready';
  checkedAt: string;                                    // ISO 8601 UTC
  identity: {
    mode: IdentityMode | 'unset';
    loopbackBind: boolean;
    status: 'ok' | 'misconfigured';
    reason?: IdentityMisconfigurationReason;            // §5.4
  };
  store: {
    db: 'ok' | 'unreachable' | 'timeout';
    migrations: 'current' | 'pending' | 'unknown';      // pending = explicit migration step not yet run (W0-04)
    blob: 'ok' | 'unreachable' | 'not_writable';
  };
  mailSink: {
    kind: 'memory' | 'file' | 'smtp';                   // slice 1 uses memory (tests) and file (dev/W7); smtp is W8
    status: 'ok' | 'unavailable';
  };
  qc: {
    kind: 'substitute' | 'deterministic' | 'model';     // slice 1: substitute; others arrive with W4 under D08/D09
    status: 'ok' | 'unavailable' | 'disabled';
  };
  build: { commit: string; schemaVersion: string };
}
```

`status` is `ready` iff `identity.status === "ok"`, `store.db === "ok"`, `store.migrations === "current"`, `store.blob === "ok"` and `mailSink.status === "ok"`. `qc.status` is reported but does **not** gate readiness: QC unavailability is a per-version finding (W0-07, workflow "Failure behavior"), submission still succeeds, and the desk must keep serving so reviewers can see the unavailable finding.

### 5.4 Identity misconfiguration reasons

Proposed here; W0-03 owns the identity adapter and confirms or amends the list. The adapter exposes `validateIdentityConfig(config): { ok: true } | { ok: false; reason: IdentityMisconfigurationReason }` and readiness calls it; the reason codes are the only text about identity that reaches the report or the log.

```ts
export type IdentityMisconfigurationReason =
  | 'mode_missing'                          // IDENTITY_MODE unset
  | 'mode_unknown'                          // not one of the three
  | 'local_google_non_loopback_bind'        // mode local-google and HOST is not 127.0.0.1 / ::1 / localhost
  | 'local_google_missing_client'           // mode local-google without the developer's Google OAuth client id/secret
  | 'network_missing_allow_list_and_ad'     // mode network with neither an allow-list nor AD configured
  | 'network_missing_credentials'           // mode network with AD chosen but no credentials in custody (D10)
  | 'production_google_enabled'             // mode production with any Google provider configured (L11)
  | 'production_missing_ad_credentials';    // mode production without True AD credentials in custody
```

### 5.5 Probes

```ts
// rai-web/server/src/observability/health.ts
export interface HealthProbes {
  db(): Promise<'ok' | 'unreachable' | 'timeout'>;                // SELECT 1 with a 2000 ms timeout
  migrations(): Promise<'current' | 'pending' | 'unknown'>;       // compare Drizzle's __drizzle_migrations to the bundled journal
  blob(): Promise<'ok' | 'unreachable' | 'not_writable'>;          // stat + access(W_OK) on the blob root; no probe file is written
  mailSink(): Promise<'ok' | 'unavailable'>;                       // memory: ok; file: directory writable; smtp (W8): connection probe
  qc(): Promise<'ok' | 'unavailable' | 'disabled'>;                // substitute: its configured health answer (§7)
}
export function computeReadiness(config: IdentityConfigView & BuildInfo, probes: HealthProbes): Promise<ReadinessReport>;
```

Probes run in parallel with the same 2000 ms ceiling each; a probe that throws is reported as its `unreachable`/`unavailable` value, never as an exception body. The readiness endpoint caches the last report for 5 seconds so a polling collector cannot turn `/readyz` into load on Postgres.

## 6. Error capture

### 6.1 Category map

Every error that reaches the Fastify error handler goes through `captureError(err, ctx)`, which classifies it into one of the seven W0-06 contract types (HTTP codes from ADR-0003), the `not_found` code ADR-0003 asked W0-06 to confirm, or `internal`. The category decides the log level, which fields are logged, whether a stack is kept and what the in-process counter records.

| Category (`code`) | HTTP (ADR-0003) | Level | Logged fields (beyond the §3.2 envelope) | Stack | Counter | Notes |
|---|---|---|---|---|---|---|
| `unauthenticated` | 401 | info | `route` | no | yes | Expected on every deep link opened without a session (W3-03); not a warning |
| `forbidden` | 403 | warn | `route`, `actorSubjectId`, `actorRole`, `action`, `targetType`, `targetId` | no | yes | Security-relevant; also emits `authz.denied`. The log may name the target ID; the response body may not reveal whether it exists (ADR-0003; 403-vs-404 open in W0-05) |
| `stale_version` | 409 | info | `route`, `caseId`, `expectedVersionId`, `currentVersionId` | no | yes | Normal concurrency; also `workflow.stale_version` |
| `invalid_input` | 422 | info | `route`, `fieldPaths[]` | no | yes | Field paths only (`"pack.slots[2].reason"`), never values |
| `unsafe_upload` | 422 | warn | `route`, `caseId`, `slot`, `reason`, `sniffedMediaType`, `declaredMediaType`, `sizeBytes` | no | yes | Also `upload.rejected`; bytes are already discarded (W0-08); never the filename |
| `qc_unavailable` | 503 | error | `route`, `qcRunId`, `caseId`, `versionId`, `reason`, `owningLane` | no | yes | Also `qc.run.unavailable`; the finding row is the durable record, the log is the trace |
| `mail_delivery_failed` | 502 | error | `notificationId`, `attempts`, `errorCode` | no | yes | Recorded on the notification record (W0-07); never returned to the business action that already committed. Captured from the W3-04 job, not from a request |
| `not_found` | 404 | info | `route`, `targetType` | no | yes | In-scope reference that does not exist; W0-06 confirms the code |
| `internal` | 500 | error | `route`, `stackHash`, `stack` | yes, sanitized | yes | Anything else, including database and `openid-client` failures. The response carries a locale key and the correlation ID only; W0-06 decides the body `code` for this case |

The user-facing message for every category is a locale key (D12) in `rai-web/shared`; the log never contains the rendered Thai or English text, only the `code`.

### 6.2 Stack sanitization for `internal`

Stacks are kept only for `internal`. Before logging, the stack is passed through `sanitizeStack`: frames only (file, line, function), the message line replaced by `err.name` plus a fixed message key, and any `openid-client`, `pg` or Fastify validation error unwrapped to its `code` so that a provider response body, a connection string or an echoed request body cannot ride along. `stackHash` (SHA-256 of the sanitized frames) lets the operator view group repeats without storing every stack.

### 6.3 Counters

`captureError` increments an in-process counter keyed by `code` (and `stackHash` for `internal`). Counters reset on restart; they are a same-process aggregate for the operator view and the W8 collector, not a durable record. The durable records are the audit event (transitions), the notification record (mail) and the QC run/finding rows (QC), which is why only those three carry the correlation ID. Nothing in §6 writes to the database.

### 6.4 Interface

```ts
// rai-web/server/src/observability/errors.ts
export type ErrorCategory = ContractErrorCode | 'not_found' | 'internal';   // ContractErrorCode: the seven codes from rai-web/shared (W0-06)

export interface CapturedError {
  category: ErrorCategory;
  httpStatus: number;
  messageKey: string;                 // locale key for the user message (D12)
  correlationId: CorrelationId;
  fields: Record<string, string | number | boolean | string[]>;   // per §6.1, allow-listed
}

export function captureError(err: unknown, ctx: RequestContext): CapturedError;   // logs `error.captured`, bumps the counter, returns the response material
export function errorCounters(): ReadonlyArray<{ code: ErrorCategory; stackHash?: string; count: number; lastAt: string }>;
```

The Fastify `setErrorHandler` (W1-00) is the only caller that turns a `CapturedError` into a response; routes throw typed contract errors from `rai-web/shared` and never build error bodies themselves.

## 7. Operator view (minimal)

### 7.1 Audience and authorization

D06 records "delivery-failure records visible to Admin" and no seventh role; W0-04 restricts the audit log to "Admin and the D06 operator audience under the same server-side check as everything else". The operator view therefore requires the **Admin** role, checked server-side by the W1-01 policy module (W0-05 adds the row "Operator view and desk health: Admin only"). Which real person holds Admin in production is the AD group mapping deferred to W6/W8 (A10); in slice 1 the fixture Admin identity is used. The view is read-only: it offers no retry button, no re-run, no disposition and no transition, so it can never act as an approval or notification path. Manual retry beyond the D06 three attempts is a W6 operator-guide question, not slice 1.

### 7.2 API

`GET /api/operator/desk-health` → `DeskHealthReport` (200), `unauthenticated` (401), `forbidden` (403 for any non-Admin role).

```ts
// rai-web/shared/src/operator.ts
export interface DeskHealthReport {
  generatedAt: string;
  readiness: ReadinessReport;                          // §5.3, the cached snapshot
  failedMail: Array<{
    notificationId: string;
    eventType: 'lane_open' | 'send_back' | 'ready' | 'sla_breach';
    caseId?: string; versionId?: string; lane?: 'ai_coe' | 'dpo' | 'it_security';
    recipient: string;                                 // shown to Admin in the authorized UI; never logged
    deliveryStatus: NotificationDeliveryStatus;         // W0-07 / W3-03 shape; must distinguish "retrying" from "failed after 3 retries"
    attempts: number; lastAttemptAt: string; nextAttemptAt?: string; lastErrorCode?: string;
    correlationId: CorrelationId;
  }>;
  unavailableQc: Array<{
    qcRunId: string; caseId: string; versionId: string;
    trigger: 'artifact' | 'pack' | 'lane';
    reason: 'timeout' | 'error' | 'disabled';
    owningLane: 'ai_coe' | 'dpo' | 'it_security';        // W0-06 owning-lane rule via W0-07
    startedAt: string;
    correlationId: CorrelationId;
  }>;
  slaDigest: {
    lastRun?: { jobRunId: string; startedAt: string; finishedAt?: string; status: 'completed' | 'failed' | 'running'; breachCount?: number; notificationIds: string[]; errorCode?: string; correlationId: CorrelationId };
    recentFailures: Array<{ jobRunId: string; startedAt: string; stage: 'query' | 'render' | 'enqueue'; errorCode: string; correlationId: CorrelationId }>;
  };
  errorCounters: ReadonlyArray<{ code: ErrorCategory; count: number; lastAt: string }>;   // since process start
}
```

Queries: `failedMail` is `notification WHERE delivery_status IN (retrying, failed) ORDER BY last_attempt_at DESC LIMIT 100`; `unavailableQc` is `qc_run WHERE result = 'unavailable' ORDER BY started_at DESC LIMIT 100`; both are scoped to all cases because Admin sees all cases (W0-05). Indexes on `(delivery_status, last_attempt_at)` and `(result, started_at)` are W3-07's migration.

### 7.3 SLA-breach digest run record (proposal for W0-04 / W3-07)

The data contract's entity list has no job-run entity, and a digest that fails **before** creating a notification record (breach query error, template render error) would otherwise leave only a log line. This spec proposes a small desk-local table, `operator_job_run` (`id`, `job` = `sla_digest`, `correlation_id`, `started_at`, `finished_at`, `status`, `breach_count`, `error_stage`, `error_code`), written by the W3-03/W3-05 digest job and read by the operator view. It is not a business entity, not exported, not a registry field and not an audit event (it records desk plumbing, not a human decision). W0-04 accepts it into the schema or W3-07 adds it in its own migration; an in-memory "last run" was rejected because it disappears on restart, which is exactly when the operator needs it.

### 7.4 Page

`/operator/desk-health` in the SPA: one page, four sections in the order of the report (readiness, failed mail, unavailable QC, SLA digest), a refresh button, no auto-refresh faster than 30 seconds. Every string carries a locale key, Thai default (D12); status is never colour-only (W0-02 UI quality bar); times render in Asia/Bangkok (D06); each row shows its `correlationId` in a copyable field so the operator can quote it against the log. Case rows link to the case (the link goes through the normal authorization, W0-05). Lane B owns `rai-web/web`; W3-07 is a Lane A ticket, so the tech lead either splits W3-07 into W3-07a (API, Lane A) and W3-07b (page, Lane B) under the PR size rule or lets W3-07 touch `rai-web/web/src/pages/operator/` as a declared contract exception. That split is the tech lead's call at W0 exit, recorded in the W0-02 plan.

## 8. Test substitutes and the W3-07 test list

### 8.1 Substitutes

| Substitute | Path | What it does | Used by |
|---|---|---|---|
| `captureLogs` / `assertNoLeak` | `rai-web/tests/helpers/log-capture.ts` | Pino destination into an array; scans every line against the forbidden list | Every integration and browser test file (W1-12) |
| `fakeProbes(overrides)` | `rai-web/tests/helpers/health.ts` | `HealthProbes` returning `ok` unless overridden per probe | Readiness unit tests |
| `identityConfig(mode, overrides)` | `rai-web/tests/helpers/identity-config.ts` | Builds each valid and each misconfigured identity configuration from §5.4 | Readiness and startup tests; W0-03 adapter tests |
| Mail sink substitute (W0-07, W1-11) | `rai-web/fixtures/mail-sink.ts` | `failNext(n)` forces `n` attempt failures; `failAlways()` forces exhaustion; records attempts | Failed-mail view, retry log lines |
| QC substitute (W0-07, W1-10) | `rai-web/fixtures/qc-substitute.ts` | `simulateTimeout()` returns `unavailable` with `reason: timeout`; `health()` answer configurable | Unavailable-QC view, `qc_unavailable` capture, readiness `qc.status` |
| Fixture clock (W3-05) | `rai-web/tests/helpers/clock.ts` | Sets the digest schedule's "now" | SLA digest run record |

Substitutes are loaded only under the test configuration; the evidence configuration cannot load them (slice-1 breakdown, W3-INT).

### 8.2 Test cases W3-07 must include (node:test unless stated)

| ID | Layer | Asserts |
|---|---|---|
| OBS-01 | unit | `computeReadiness` returns `not_ready` with the exact `reason` for each of the eight §5.4 misconfigurations, and `ready` for a valid `local-google` loopback configuration with all probes ok |
| OBS-02 | integration | Starting the server with `local-google` and a non-loopback `HOST` logs `process.refused` with `local_google_non_loopback_bind`, exits non-zero and never listens (port stays closed) |
| OBS-03 | integration | `GET /readyz` returns 503 with `store.db: "unreachable"` when the database URL points at a closed port, and 200 against the compose Postgres with migrations applied; with migrations not applied it returns 503 `migrations: "pending"` |
| OBS-04 | integration | `GET /healthz` returns 200 while the database is unreachable and produces no log line |
| OBS-05 | integration | The `ReadinessReport` body, serialized, contains no `DATABASE_URL` fragment, no hostname, no path and no `Error` message text |
| OBS-06 | integration | A submit request (W1-05) writes one audit event; its `correlation_id` equals the `X-Request-Id` response header and equals the `correlationId` on every log line emitted during the request |
| OBS-07 | integration | A lane decision that commits a notification (W3-03) yields a notification record whose `correlation_id` equals the audit event's; a decision that rolls back (forced stale version) yields neither row and no `mail.enqueued` line with that ID |
| OBS-08 | integration | A lane-approval attempt that triggers the QC substitute (W2-05) writes a QC run whose `correlation_id` equals the request's |
| OBS-09 | integration | With `failAlways()` on the mail sink, a send-back produces exactly one `failedMail` entry in `GET /api/operator/desk-health`, `mail.failed` appears exactly once in the log, and both carry the same `correlationId`; `mail.attempt_failed` appears three times with `attempt` 1-3 and `mail.failed` carries `attempts: 4` (first send plus three retries, D06) |
| OBS-10 | integration | With `simulateTimeout()` on the QC substitute, a submit produces exactly one `unavailableQc` entry and exactly one `qc.run.unavailable` line with the same `correlationId`; the finding row exists with `owning_lane` set |
| OBS-11 | integration | A forced digest failure at each `stage` writes an `operator_job_run` row and one `sla.digest.failed` line with the same `correlationId`, and the view's `slaDigest.recentFailures` lists it |
| OBS-12 | integration | `GET /api/operator/desk-health` is 401 without a session, 403 for each of the five non-Admin fixture roles (including the dual-role fixture identity), 200 for Admin |
| OBS-13 | integration | Each of the seven contract errors, forced in turn, produces one `error.captured` line with the correct `category`, `httpStatus` and level, an `X-Request-Id` header, and a body `correlationId` equal to it; `invalid_input` logs `fieldPaths` and no submitted value; `unsafe_upload` logs no filename |
| OBS-14 | integration | An injected internal error produces `error.captured` with `category: "internal"`, a `stackHash`, and a stack that contains no `DATABASE_URL`, no request body and no fixture canary |
| OBS-15 | integration (suite-wide) | `assertNoLeak(capture, FIXTURE_FORBIDDEN)` passes after the full W1-W3 integration suite, including the Thai-named fixture upload, a search for a fixture person's name and a sign-in |
| OBS-16 | unit | `log("upload.stored", { filename: "x" })` throws `OBS_UNREGISTERED_FIELD` under the test configuration; under the production configuration the field is dropped and the line is still emitted |
| OBS-17 | browser (Playwright) | As Admin, `/operator/desk-health` shows the OBS-09 failed mail and the OBS-10 unavailable QC run once each with their correlation IDs; as owner it shows the forbidden message; the accessibility audit reports zero critical; no hard-coded user-facing string |

W3-07's done-when in the slice-1 breakdown maps to OBS-09, OBS-10 (once each in view and log, same ID), OBS-01/02 (fail closed) and OBS-15 (no document content or personal data in any log line).

## 9. Configuration this spec needs

Variable names are placeholders for the W0-02 env list; W1-00 creates the sample file. No value here is a secret.

| Variable | Default | Used by |
|---|---|---|
| `LOG_LEVEL` | `info` | §3.1 |
| `LOG_PRETTY` | `false`; `true` only in `npm run dev` | §3.1 |
| `IDENTITY_MODE`, `HOST` | from W0-03 / W0-02 | §5.2, §5.4 |
| `DATABASE_URL`, `BLOB_ROOT`, `MAIL_SINK_KIND`, `MAIL_SINK_DIR` | from W0-02 / W0-04 / W0-07 | §5.5 probes; never logged |
| `HEALTH_PROBE_TIMEOUT_MS` | `2000` | §5.5 (a constant unless an operator needs to change it; listed so W8 can) |
| `BUILD_COMMIT` | set by the build; `dev` locally | §5.3 `build.commit` |

## 10. Hand-off to W7 and W8

**W7 (operator rehearsal, W6 operator guide).** The guide's "failed-mail and unavailable-QC views" and "queue and SLA report" sections point at `/operator/desk-health`; the "incident shutdown path (disable mail, disable QC, freeze transitions)" reads its state from `readiness.mailSink` and `readiness.qc`. W7-00's restore rehearsal re-checks `GET /readyz` after restore (`migrations: "current"`, `blob: "ok"`) and verifies that restored audit, notification and QC rows still share their correlation IDs (A07/A11 re-verification).

**W8 (True-side monitoring integration, D10).** W8 chooses the log collector and alert channel; this contract gives it: JSON lines on stdout with the §3.3 event names, `GET /healthz` for the process supervisor, `GET /readyz` for the load balancer or scheduler, the §6.1 category names for error-rate alerts, and the guarantee that nothing in the log needs redaction at the collector because redaction happened at the emitter. W8 must not add fields, events or a second logger; changes come back to this contract. Log retention is operational on the host and is confirmed in the D08/D10 review together with audit retention (W0-04).

## 11. Cross-references

| Spec / ticket | What this contract takes from it | What it gives back |
|---|---|---|
| [ADR-0003](../../adr/0003-stack-and-deployment-boundary.md) (W0-01, D04) | Fastify/pino, Drizzle/Postgres, openid-client, node:test, Playwright; HTTP codes for the seven errors; "every response carries ... the request correlation ID" | The correlation ID and readiness rules the ADR's risk table cites ("readiness check fails closed (W0-10)") |
| [W0-02](../delivery/w0-technical-contract.md#w0-02--file-level-implementation-plan) | Paths (§1), env variable list (§9), CI wiring of `assertNoLeak` (W1-12), the W3-07 split decision (§7.4) | Paths for the "Desk observability" row of the [architecture table](../architecture/README.md) |
| [W0-03](../delivery/w0-technical-contract.md#w0-03--identity-adapter-spec) | `IdentityMode`, the fail-closed rule, `validateIdentityConfig` | The reason-code enum proposal (§5.4) |
| [W0-04](../delivery/w0-technical-contract.md#w0-04--persistence-and-artifact-store-spec) | Audit events append-only, same transaction, carry the correlation ID; migrations explicit | `correlation_id uuid NOT NULL` on audit_event, notification, qc_run; the `operator_job_run` proposal (§7.3); readiness `migrations: pending` |
| [W0-05](../delivery/w0-technical-contract.md#w0-05--authorization-policy-matrix) | Admin sees all cases; the 403-vs-404 open item | The row "operator view and desk health: Admin only" (§7.1) |
| [W0-06](../delivery/w0-technical-contract.md#w0-06--workflow-transition-and-error-contract) | The seven error types, `not_found` confirmation, transition names, owning-lane rule | Level, fields and counter per category (§6.1) |
| [W0-07](../delivery/w0-technical-contract.md#w0-07--qc-boundary-and-mail-sink) | QC run / `unavailable` result, notification delivery status, substitutes that simulate timeout and failure | The `failNext`/`failAlways`/`simulateTimeout`/`health()` hooks the substitutes must expose (§8.1) |
| [W0-08](../delivery/w0-technical-contract.md#w0-08--upload-safety-policy-and-fixtures) | Fixture set, Thai-named file, synthetic operator recipient, sniffing rule | The fixture canary convention (§4.3) and the `upload.rejected` fields |
| [Slice-1 breakdown](../delivery/slice-1-work-breakdown.md) W1-05, W2-02, W2-05, W2-06, W3-03, W3-04, W3-05, W3-07, W3-INT | Their done-when clauses that name the correlation ID, delivery status and digest | OBS-01 to OBS-17 |
| [Threat model](../security/threat-model.md) | "Credentials/PII in prompt, logs or email", "Email fails or repeats", "QC/model outage presented as clean evidence" | §4 redaction, §7 failed-mail and unavailable-QC visibility |
| [Later packages](../delivery/later-packages-outline.md) W6, W7, W8 | Operator guide sections, W7-00 rehearsal, True-side monitoring | §10 |

## 12. Open items (not decided here)

- [ ] W0-03 confirms or amends the `IdentityMisconfigurationReason` list (§5.4).
- [ ] W0-04 accepts `operator_job_run` into the schema or assigns it to W3-07's migration (§7.3).
- [ ] W0-06 confirms `not_found` and the response `code` for `internal` (§6.1).
- [ ] W0-02 records the W3-07 page split (§7.4) and the exact paths in §1.
- [ ] W0-05 resolves 403-vs-404 for out-of-scope references; the `forbidden` log fields in §6.1 are unaffected either way.
- [ ] D08/D10: log retention on the host, alongside audit retention; the redaction rule is designed so that this is an operational question, not a personal-data one, but the DPO review confirms it before real data.
- [ ] W8: collector, alert channel and any exposure of `/readyz` beyond loopback.
