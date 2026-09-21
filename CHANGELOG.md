# Changelog

## 2026-09-21

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
