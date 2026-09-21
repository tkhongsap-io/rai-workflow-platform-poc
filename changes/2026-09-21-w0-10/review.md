# Review: W0-10 — observability contract for the desk runtime

2026-09-21. Ticket W0-10 (issue #15), branch `codex/w0-10-observability-contract`, worktree `/Users/tkhongsap/github/rai-wt/W0-10`. Agent-eligible draft; human review pending per the ticket's owner type; independent reviewer agents run before merge per the D03 amendment.

## What landed

- `docs/engineering/observability-contract.md`: the W0-10 specification, concrete for the D04 stack (ADR-0003) and stack-neutral in intent. It covers the five bullets of the W0 contract section and the interface / error contract / test substitute triad the ticket asks of W0-03/04/07/10:
  - **Correlation ID** (§2): server-minted UUID per request via Fastify `genReqId`, carried in `AsyncLocalStorage`, written to the audit event, the notification record and the QC run in the same transaction; job-level rules for mail retries (reuse) and the SLA digest (minted per run); client `X-Request-Id` never trusted; `correlation_id uuid NOT NULL` stated as the column contract for W0-04/W1-00.
  - **Structured event logging** (§3): JSON lines on stdout through Fastify's built-in pino (no new dependency), a fixed line envelope and a 24-event catalogue with per-event field allow-lists; volume rules (one line per request, no asset or liveness lines).
  - **Redaction rule** (§4): the never-logged classes (document contents, personal data including filenames and recipients, tokens and credentials, deep-link secrets, user-typed free text, raw URLs); an allow-list emitter that throws on unregistered fields in test plus pino `redact` as backstop; fixture canaries and a suite-wide `assertNoLeak` helper.
  - **Liveness and readiness** (§5): `GET /healthz` (no dependencies) and `GET /readyz` (identity mode, store: db/migrations/blob, mail sink, QC); one pure `computeReadiness` used by both the startup gate (exits, never binds) and the endpoint, so identity misconfiguration fails closed; a proposed reason-code enum for W0-03; report body restricted to enumerated codes.
  - **Error capture** (§6): the seven W0-06 types with ADR-0003 HTTP codes, plus `not_found` (for W0-06 to confirm) and `internal`; level, allow-listed fields, stack policy and counters per category; stack sanitization; `captureError` interface.
  - **Operator view** (§7): Admin-only (D06 "visible to Admin", no seventh role) read-only `GET /api/operator/desk-health` with failed mail, unavailable QC runs, SLA-digest run status and error counters; the `operator_job_run` table proposed for W0-04/W3-07; a minimal SPA page with locale keys and the W3-07 lane-split question left to the tech lead.
  - **Test substitutes and the W3-07 test list** (§8): OBS-01 to OBS-17, mapped to the W3-07 done-when clauses.
  - Configuration placeholders for W0-02 (§9), hand-off to W7 and W8 (§10), cross-references to every W0 spec and the consuming tickets (§11), open items with their owners (§12).
- `changes/2026-09-21-w0-10/review.md`: this record.

Not edited, on purpose: `adr/README.md` (no ADR is produced or changed by W0-10), `docs/architecture/README.md` "Path in repo" column and `TESTING.md` (W0-02 only), `docs/product/decisions.md` and `docs/product/source-spec.md` (frozen / agents never record decisions), the ticket row status (issue #15 tracks it), DEVLOG/CHANGELOG/board (appended by the merge step, as for W0-01).

## Dependency note

W0-06 (issue #11) had not merged when this was written; the W0-06 rules are taken from the W0 contract section and the HTTP codes from ADR-0003, which W0-06 inherits. Cross-links point at the contract's W0-0x section anchors rather than at not-yet-existing `docs/engineering/` files; the reviewer of whichever spec lands second replaces them with file links. Paths use the `rai-web/*` layout ADR-0003 proposed for W0-02 and are marked as yielding to W0-02.

## Checks

Shell: `export PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH` (node v24.21.0).

| Command | Result |
|---|---|
| `node --test tests/*.test.mjs` | 22 pass, 0 fail, 0 skipped |
| `git diff --check` | clean |
| `shasum -a 256 docs/product/source-spec.md` | `92c4f7123058b8fec3c2ba7abdf10538fad034778624b0675975b39de440b354`, matches docs/sources.md |
| Relative-link audit over the new document | 16 links, 0 broken; all 9 W0-contract section anchors resolve |
| Section cross-reference audit (`§n.m` against headings) | all resolve |

No product suite exists yet (the application skeleton arrives with W1-00 under the layout W0-02 assigns), so `npm test`, lint, typecheck, Playwright and Postgres do not apply to this ticket; no container was started.

## Done-when check (W0-10 section and exit checklist)

- [x] Structured event logging with a correlation ID that is the same value on the audit event, the notification record and the QC run for one request (§2, §3).
- [x] Redaction rule: no document contents, personal data, tokens or deep-link secrets in logs, with the mechanism and the test that enforces it (§4).
- [x] Liveness and readiness reporting identity mode, store reachability and mail-sink status; fails closed on identity misconfiguration (§5).
- [x] Error capture categorised by the seven contract error types (§6).
- [x] Operator view, minimal: failed mail, unavailable QC runs, SLA-breach report generation (§7).
- [x] True-side monitoring integration left to W8 (§10).
- [x] Interface, error contract and test substitute specified (§1, §6, §8); cross-linked to the other W0 specs and the consuming tickets (§11).
- [x] Desk health only; no AI-use-case monitoring, no registry health fields, no L2/L3 writes.
- [x] D07-D10 untouched; no D01-D12 decision recorded; frozen source spec unchanged; proposals labelled as proposals with an owner (§12).
