# Changelog

## 2026-09-23

- Final W3 delivery: all nine engineering tickets merged, including PR #125 (`e62b669`). Actual-main CI [35781574925](https://github.com/tkhongsap-io/rai-workflow-platform-poc/actions/runs/35781574925) passed all 12 checks. Reconciled delivery records after merge; Ta’s package review, manual Google sign-in, workload confirmation and finding-ownership policy remain pending.

- W3-06: Added the synthetic engineering exit, acceptance map, source-attributed test evidence, supplementary keyboard recording and guarded performance harness. Preserved raw measurements and failed attempts; reconciled current-state documentation with implemented W3 and the existing D03 review delegation. Team/operator acceptance and production gates remain explicit.

- W3-INT: Integrated real-server queue, protected notification links, postcommit submit QC and Admin diagnostics with a single-case keyboard/restart journey. Added actual worker-failure, late-QC/restart and suite-wide integration log-privacy regression coverage; moved the API substitute entirely into the test harness. Browser fixtures own and drain their test server before resetting data; notification checks observe committed worker completion. Completed cases show persisted read-only findings without an automatic QC error, including completion by final disposition. Clean-checkout tests now build required outputs before importing or starting the built server. Synthetic package exit evidence remains separate from production acceptance.

- W3-07b: Bilingual Admin operator desk-health page for readiness, failed mail, unavailable/late QC, digest and safe error counters. Manual refresh and session guards prevent stale Admin reports from remaining visible. Delivered in PR #119; real-server operator verification was completed in W3-INT and included in final-main CI.

- W3-07a: Dependency-aware health/readiness, Admin desk-health API, safe correlated errors and durable unavailable/late-QC diagnostics. Notification delivery remains on the existing worker.

## 2026-09-22

- W3-03b: Local daily SLA digests with persisted job provenance, configured-recipient deduplication and partial-failure recovery through the existing retry worker.

- W3-04: Persisted notification retry deadlines, four-attempt terminal failure and concurrent-worker exclusion. File-sink browser verification now isolates its outbox from the suite worker.

- W3-03a: Committed-event lane-open, send-back and Ready notifications through the local mail sink; bilingual content, Gregorian Thai dates, protected links and bounded background shutdown. Daily digest, retries and the operator view remain later W3 tickets.

- W3-02: Bilingual queue cards, URL filters/pagination, version and lane due dates, keyboard access and loading/error recovery. Both Reset paths clear draft filters. Real-server integrated acceptance remains W3-INT.

- W3-08: scoped queue substitute: The dev/test-only API substitute now implements the queue contract, including scoped filters/counts, pagination, successor versions and frozen SLA dates. Regression tests cover role scopes, unknown query keys and disposition states. Full local verification passed: 413 unit, 198 integration and 213 browser tests. Independent review is clean after fixes. PR #108; integration acceptance remains W3-INT.

- W3-01: scoped server queue: GET /api/queue applies authorization before search, counts, options and pagination in one consistent database snapshot. Results expose current lane state and frozen SLA dates while retaining successor draft versions. Full local verification passed: 409 unit, 205 integration and 213 browser tests. Independent review is clean. PR #109; 1,000-case latency and integrated M3 evidence remain pending.

- W3-05 (PR #104, `39bbf0a`): Working-day SLA due dates from the SLA and holiday list frozen at submit (Asia/Bangkok; weekends and holidays skipped; the open day is not counted). A later SLA revision does not move an already submitted version. Resubmit starts a new clock. `listSlaBreaches` returns only pending lanes on the current review target that are past due. No SLA HTTP route, no mail, no escalation. Issue #46 closed. Next ticket is W3-01 (queue), which can use the due-date shape. W3-03 and W3-04 still need the W1-11 mail sink on `main` (PR #68 merged only onto `codex/w1-00-mail-dedup`).

- Case-row lock (PR #103, `7382222`): Lane QC no longer holds `SELECT … FOR UPDATE` across the QC runner. Persist re-locks, treats an open successor draft as `version_closed`, and replays a completed run that landed during the call.

- W2-08 (W2 exit, Milestone M2, PR #102): Evidence in changes/2026-09-22-w2-exit/review.md. Three parallel lanes, send-back, dispositions, Ready, and the real-server journey. Issue #35 and epic #53 stay open (owning lane for slot 5, slot 9, pack-level, and unavailable findings is unrecorded). Ticket-level notes are in DEVLOG.md.

- W1-08 (W1 exit, Milestone M1): evidence record changes/2026-09-22-w1-exit/review.md from a clean checkout — 347 unit, 135 integration, 108 evidence browser tests, exit negatives and the restart journey quoted against the built server, fixture set slice1-synthetic@1 7c80ccd43663; A01 (local), A02, A07 mapped to their tests; Google loopback sign-in runbook in TESTING.md, pending Ta; BUILD_PLAN W1 exit recorded, M1 reached, W2 ready.

## 2026-09-21

- W1-08 (PR #88): W1 exit (Milestone M1): clean-checkout evidence for A01/A02/A07 with every command and output, explicit fail-closed and scope negatives, hand-run restart journey with byte-identical bodies and download; Google-on-loopback runbook in TESTING.md pending Ta; W2 issues flipped to ready; epic #52 closed.

- W1-INT (PR #87): SPA served by the real server; Lane B journeys promoted to evidence against real Postgres (108 browser tests); create→attach→submit→restart→reopen journey with byte-identical download; SPOC-on-behalf positive; all exit negatives; fixed a graceful-shutdown hang on idle sockets found by the restart test; 347 unit + 135 integration.

- W1-00-w1-06-locale-contract (PR #86): W1-00 amendment (contract PR for W1-06): locale keys for the case overview, pack editor and version navigation.
- W1-06 (PR #82): Case overview, nine-slot pack editor with contained N/A-reason dialog, version navigation, integrated onto the W1-07 shell/router/client; keyboard-only and axe zero-critical at three widths; 331 unit, 390/390 repeated substitute runs.

- W1-07 (PR #85): React SPA shell, i18n provider (th default, en), sign-in, new-case form, own/BU case list on the W1-13 substitute; keyboard-only and axe zero-critical at 1440/834/390; 57 substitute browser tests; re-targeted onto main after #83 landed on its contract branch; main-focus checks now poll.

- W1-04 (PR #80): Nine-slot draft pack per 7.5: four slot states, mandatory N/A reason, slots 3/4 default N/A only when vendor_involved is false, checklist_template_version and stage_context on the draft, expectedVersion 409 rule, audit events; 285 unit + 103 integration.

- W1-13 (PR #79): Lint green on main: StageContextSchema spelled out as a literal tuple (byte-identical JSON schema); the substitute contract-cast helpers are identity functions.

- W1-03 (PR #78): Artifact upload/download per 7.4: content-hash blob store behind an interface, sniffing not extension, size limits, unresolved-id rule, Thai filenames, direct URL without session refused; store:verify/cleanup operator commands; 197 unit + 53 integration.
- W1-13 (PR #77): Dev/test-only in-memory API substitute serving every 7.2-7.6 shape from the fixture set with the W0-06 error envelope; absent from the production build; 61 new tests.

- W1-12 (PR #75): Browser job green on main: Playwright web server now builds the fixtures workspace (server refused with fixture_outside_test on clean checkouts), and the harness spec asserts the fixture sign-in route W1-01 added. Found by independent review.

- W1-09 (PR #72): Synthetic fixture set slice1-synthetic@1 (5 cases, 33 generated documents incl. Thai-named file, dual-role SPOC case), fixtures:generate/load, denylist test; migration renumbered to 0002 after the W1-01 collision.

- W1-10 (PR #69): QC substitute: scripted findings by version ref, unavailable, timeout, QC_RUNNER=none, provable no write path.
- W1-11 (PR #68): Mail-sink substitute: four inputs, delivery status, forced failure, dedup key, provable no external mail path.
- W1-12 (PR #70): CI workflow (11 jobs: unit, integration on Postgres, lint, typecheck, build, link check, frozen-source hash, demo suite, browser/Playwright) and local harness scripts; altered-snapshot hash test.

- W1-00 (PR #67): First code: rai-web workspaces, docker compose Postgres, Drizzle base migration (case, pack_version, artifact_slot, configuration_revision, append-only audit_event with DB trigger), shared error module, policy module, fixture identity provider, configuration seed, logger; 58 unit + 14 integration tests.

- W0-09 (PR #66): W0 exit: cross-spec consistency pass over all nine W0 documents (error envelope, ExpectedVersion, routes, paths, log fields, dedup key, fixtures aligned to their owners), performance targets recorded, exit checklist ticked, changes/2026-09-21-w0-exit/review.md.

- W0-05 (PR #58): Authorization policy matrix: role x action x scope with D05 rows, status-field projection rule, route-verbatim middleware facts, unresolved-target rule, 34+ test obligations; aligned to merged W0-02/W0-04/W0-06/W0-10.

- W0-07 (PR #60): QC boundary and mail sink spec: typed findings with owning lane, run keys, unavailable results, substitute with timeout; mail sink with dedup key aligned to the W0-04 notification index and W0-10 log fields.

- W0-03 (PR #62): Identity adapter spec: modes local-google/network/production with fail-closed start-up table S1-S18, session, fixture provider with dual-role identity, test obligations.
- W0-08 (PR #64): Upload safety policy and synthetic fixture strategy: allowed types, limits, sniffing rules, filename rule, hostile test rows, four fixture cases and users.

- W0-02 (PR #65): File-level implementation plan for W1-W3: layout, commands, pinned deps, env list, CI checks, W1 interface shapes, test-layer map, UI quality bar, language rule; architecture paths and TESTING commands filled.
- W0-04 (PR #61): Persistence and artifact-store spec: entities, immutability, transactions, audit log, schema evolution, retention options for D08.
- W0-06 (PR #63): Workflow transition and error contract: states, events, lane-mapping constant, D05 rules, owning-lane assignment, seven error types with HTTP codes.
- W0-10 (PR #59): Observability contract for the desk runtime: correlation IDs, redaction, readiness, error capture, operator view.

- W0-01 (PR #57): ADR-0003 stack and deployment boundary (D04): Fastify API serving React SPA, Postgres, Drizzle, openid-client; scored against seven criteria.

- Opened GitHub issues for W0-W3: four epics, 45 tickets, labels, milestones and dependency links; documented the tracker in the delivery README.

- Closed G0: recorded D01 (Nakhun), D02, D03 (W0-W3 authorized, synthetic data), D05, D06, D11 and D12; propagated the answers through PRD, workflow, data contract, acceptance, BUILD_PLAN, AGENTS, README, TESTING and the delivery pack. D04, D07-D10 remain open.

- Reviewed and restructured the delivery pack for parallel lanes (contract-first W1-00, Lane C, Wx-INT, `Done when`, merge order); added W0 observability/audit/schema/accessibility/language rules, BUILD_PLAN principles, risks and dated status, ADR template and index, build board, architecture boundary map; added D12 (register row) and A11 (acceptance), both accepted by Ta on 2026-09-21. Planning only.
- Added a delegation-ready delivery pack (docs/delivery): G0 and slice-1 decision briefs, team RACI and AI-agent limits, W0 technical contract, W1-W3 tickets with acceptance traceability, design-to-build map and W4-W8 outline. Planning only; no stack chosen and no code.

- Added a README user-journey diagram covering parallel reviews, versioned corrections, finding dispositions and the external authorization boundary; documented demo limits and pending production decisions.

- Created a 30-second 1080p social demo video with True branding, feature close-ups, captions and original sound cues; includes poster, capture provenance and reproducible renderer.

- Passed the revised functional gate with 22 unit/provenance tests and four localhost browser suites. Prevented invalid Admin settings from publishing; kept discard available during validation errors. Owner accepts small visual differences.

- Added the original Claude design as a runnable local synthetic demo, a design-specific PRD/plan, unit tests and browser journey test. Corrected dropdown labels in the local runtime. Verified 58 state/width comparisons with equal measured styles and sub-0.001px geometry differences; pixel equality remains unverified under lossy screenshot capture.

## 2026-09-20

### Added
- True Corp-styled interactive review-desk design in Claude Design, with prompt, workflow storyboard, developer handoff and browser iteration evidence. Design only; production implementation remains gated.
- Root PRD and detailed build plan, with requirement-to-package mapping, dependencies and acceptance evidence; README now leads with these product anchors.
- Documentation-only RAI review-desk foundation, source provenance, workflow and data contracts, acceptance criteria, threat and QC evaluation plans.
- Pinned AI Engineering Playbook adoption record and implementation gates.

No application or operational capability is implemented.

## 2026-09-22 — W3-07a prerequisite contract

Added shared observability shapes and additive persistence for digest provenance/dedup, truthful QC unavailable reasons and durable late-QC refusals. Reconciled HTTP/job error capture and synthetic integration gates. Runtime consumers remain separate work.

## 2026-09-23 — W3-07a runtime candidate

Added health/operator routes, safe HTTP/job capture and correlated QC diagnostics through the existing runtime. Actual-main assembly preserves the independently reviewed and fully tested c98ad3e application tree. W3-INT submit binding and remaining acceptance boundaries stay explicit; parent scope approval and publication are pending.
