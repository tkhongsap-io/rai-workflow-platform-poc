# Development log

## W3-04: bounded notification retries — 2026-09-22

One notification dispatcher records up to four committed attempts with persisted backoff, preserves committed workflow decisions and drains safely. Independent review is clean after a full-run discovery led to isolated file-sink browser databases. Admin visibility and the integrated journey remain W3-07/W3-INT gates.

## W3-03a: committed case notifications — 2026-09-22

Lane-open, send-back and Ready messages are composed from committed outbox/audit records with scoped synthetic recipients, protected version links and bilingual templates. Thai dates use Gregorian years. Initial delivery cannot undo a committed decision; background shutdown is bounded and retains active transaction locks until settlement or process exit. Independent review is clean after both fixes. Digest, retries and operator visibility remain separate tickets.

## W3-02: queue UI — 2026-09-22

The bilingual queue renders server-scoped cards, status counts, current lane dates and the latest version. Filters and pagination survive reload and browser history; loading/error states suppress stale results. Both Reset paths clear unapplied edits after independent review found and verified regressions. The shared contract is PR #110. Substitute UI verification is separate from W3-INT real-server journey acceptance.

## W3-08: scoped queue substitute — 2026-09-22

The dev/test-only API substitute now implements the queue contract, including scoped filters/counts, pagination, successor versions and frozen SLA dates. Regression tests cover role scopes, unknown query keys and disposition states. Full local verification passed: 413 unit, 198 integration and 213 browser tests. Independent review is clean after fixes. PR #108; integration acceptance remains W3-INT.

## W3-01: scoped server queue — 2026-09-22

GET /api/queue applies authorization before search, counts, options and pagination in one consistent database snapshot. Results expose current lane state and frozen SLA dates while retaining successor draft versions. Full local verification passed: 409 unit, 205 integration and 213 browser tests. Independent review is clean. PR #109; 1,000-case latency and integrated M3 evidence remain pending.

## Handoff after W3-05 — 2026-09-22

`main` is `39bbf0a`. W3-05 (PR #104) and the QC case-lock fix (PR #103, `7382222`) are recorded in CHANGELOG.md and in the BUILD_PLAN status section. README build status no longer says the next step is W0. **Next ticket is W3-01** (role-scoped queue). It can use `LaneDue` / `SlaBreach`. Do not start W3-03 or W3-04 until the W1-11 mail sink is on `main`. Issue #35 and epic #53 stay open. W4–W8 are not authorized.

## W3-05: working-day SLA — 2026-09-22

A lane's due date is computed from the version's `submitted_at` and the `sla` and `calendar` revisions frozen at submit (Asia/Bangkok, weekends and the frozen holiday list skipped, open date not counted). A later SLA revision does not move an already-frozen version. Resubmit starts a new clock. `listSlaBreaches` returns only pending lanes on the current review target whose due date is before the as-of Bangkok day. No SLA HTTP route, no mail send, no escalation. Issue #35 stays open.

## QC case lock: 2026-09-22

Lane QC no longer holds `SELECT … FOR UPDATE` on the case row while `runner.run` is in flight. `lock_timeout` is 5s and the runner may take up to 10s, so the old transaction turned every other action on that case into a lock-timeout 500. The runner is awaited after the prepare transaction commits. Persist takes a new short transaction, re-checks that the version is still the open submitted target, and replays a completed run that landed while QC was in flight. A send-back during the run sets `draft_version_id` and leaves `current_version_id` on N; persist treats that open draft as `version_closed` and writes no `qc_run`. Issue #35 stays open.

## Milestone M2 / W2 exit: 2026-09-22

W2 exit recorded from `origin/main` at `2f919eb` ([review](changes/2026-09-22-w2-exit/review.md), ticket W2-08 / issue #41). Fixture set `slice1-synthetic@1 7c80ccd43663`. From `rai-web/`: `npm run lint` and `npm run typecheck` green; W2-INT Playwright evidence `15 passed (31.0s)` (journey + reviewer workspace + disposition at three widths); W2-INT negatives `6 pass / 0 fail` (concurrent send-back one draft, stale approval, undispositioned finding blocks Ready, Admin 403, owner 403, BU SPOC self-approval 403); `npm run build && npm run check:substitute-absent` scanned 463 files, 0 with the marker; `w1-00-audit.test.ts` 4 pass / 0 fail (A11 UPDATE/DELETE refusal). Journey: v1 → one send-back → v2 → three approvals → Ready after disposition. A11: journey asserts only `lane.opened`; related types cited from W2 ticket tests. QC remains the slice-1 substitute stand-in; real QC is W4; issue #35 stays open. Google loopback sign-in stays the W1 pending item (not a W2 blocker). M2 reached; M3 unblocked; next is W3. W4–W8 not authorized. Epic #53 not closed by this record.

## W2-09: findings and disposition UI — 2026-09-22

On a current submitted version the owning-lane reviewer runs `POST …/qc-run` then enriches each finding with `latestDisposition` from `GET …/versions/:versionId/findings` (authorized as `version.view`; does not insert a `qc_run`). Owner/BU SPOC load that GET only and may propose fixed; qc-run auth is unchanged. After every disposition POST the GET is refetched so a reload shows the kind. Waived and N/A open the shared reason dialog. Every disposition kind is reachable on the W2-10 substitute (owner propose → lane confirm; waive with reason). Ready on the disposition response shows the existing `review.decided.ready` notice. Single-lane findings only; issue #35 stays open. This is not the W2 exit.

## W2-07: reviewer workspace UI — 2026-09-22

On a current submitted version the owning-lane reviewer sees that lane's QC findings (from `POST …/qc-run`) above approve / send-back. Controls wait for the run, including an unavailable run (still has a run id). Send-back reuses the shared dialog and cannot submit without naming a slot. Admin, owner, wrong lane and stale/superseded versions never draw the buttons. History keeps frozen N readable after send-back. Substitute Playwright path is keyboard-only with axe zero critical / zero serious. Copy comes from the catalogue keys in the W2-07 contract PR. This is not the W2 exit; disposition UI remains W2-09.

## W2-07 locale keys — 2026-09-22

Reviewer-workspace copy (`review.*`, `finding.severity.*`) is in both catalogues so the Lane B screen can read keys without editing `shared/` in the UI PR. Not the W2 exit.

## W2-10: API substitute W2 shapes — 2026-09-22

The W1-13 in-memory API substitute now answers the W2 HTTP shapes the real server already serves (lane approve / send-back, lane qc-run, finding dispositions), including forbidden and stale_version / 422 cases, so Lane B can build UI without editing the substitute. Ready is set only inside approve or disposition when three current-version approvals exist and no finding is undispositioned; there is no POST `/ready`. History remains the existing version read; send-back does not mutate version N and reuses one successor draft. Slot-5, pack-level and unavailable findings are not stored. Still absent from non-test builds (`check:substitute-absent`). This is not the W2 exit.

## W2-06: Ready predicate — 2026-09-22

Ready is a system transition inside `lane.approved` and disposition (same transaction, under the case row lock): three current-version approvals and zero undispositioned findings set `pack_version.ready_at`, `desk_status` / `ai_readiness_status` to `ready`, one `case.ready_for_launch` audit (`triggered_by` the triggering event), and one `ready` notification outbox row (lane `-`). No POST `/ready`. An open finding or a prior-version approval blocks it; `fixed_proposed` alone does not count; mutating approve/disposition after Ready is `409 version_closed`. This is not the W2 exit; UI and mail delivery remain later tickets.

## W2-05: findings and dispositions (single-lane) — 2026-09-22

A submitted version can record synthetic single-lane defect findings from the W1-10 QC substitute (lane QC run endpoint) and disposition them append-only under D05. Owning lane is assigned only via W0-06 §7.1 (`owningLaneForSlot`); slot 5, slot 9, pack-level and unavailable findings are not stored — agents do not invent a lane. An unavailable substitute result stores a `qc_run` with `status = unavailable` and zero `qc_finding` rows (W0-06 §7.4 blocks the unavailable finding only, not the run row); it is never treated as a clean completed run. Ready (`ready_at` / desk_status ready) is not set here (W2-06). Issue #35 stays open for the §7.3 cases named in its done-when. This is not the W2 exit.

## W1-10 on main — 2026-09-22

The QC substitute (scripted findings, unavailable, timeout, no write path) had merged only onto `codex/w1-00-qc-shared-contract` (PR #69), not `main`. This brings those files onto `main` so W2-05 can record single-lane findings through it. It is still a substitute. QC is not implemented. Slot 5, slot 9, pack-level and `unavailable` owning lanes stay unrecorded (W0-06 §7.3).

## W2-04: resubmit N+1 under D05 — 2026-09-22

Resubmit is submit of a successor draft (`parent_version_id` set) on the existing POST `/api/cases/:caseId/draft/submit` route. Freezes N+1, opens all three lanes pending, writes `version.resubmitted` then `lane.opened` × 3, resets lane projections and `ai_readiness_status` to `not_ready`, stores idempotency action `case.resubmit`, and leaves N's lane decisions untouched. Approve/send-back naming N after resubmit is `409 version_superseded`. This is not the W2 exit; findings/dispositions (W2-05), Ready (W2-06), UI and mail delivery remain later tickets.

## W2-03: successor draft concurrency — 2026-09-22

Concurrent send-backs on the same submitted version share one editable N+1 draft because the case row lock serialises decide and `ensureSuccessorDraft` reuses `case.draft_version_id` when set; version N stays readable and frozen; stale actions return 409 with refresh guidance and write nothing. This is not the W2 exit; resubmit (W2-04), findings/dispositions, Ready, UI and mail delivery remain later tickets.

### Fix round 1

Removed the SAVEPOINT / UniqueViolation reclaim (unreachable under the case lock and would skip setting `draft_version_id`). An unknown version UUID is `not_found`, not `version_superseded`.

## W2-02: lane decision — 2026-09-22

Lane approve and send-back are live (own lane only, expected version, idempotency, D05 self-exclusion, decision audit, successor draft on first send-back). This is not the W2 exit; concurrent send-back (W2-03), resubmit, findings/dispositions, Ready, UI and mail delivery remain later tickets.

### Fix round 1

LaneSchema uses explicit literals (typecheck under noUncheckedIndexedAccess). Decide no longer compares or bumps `case.row_version` (§5.1 / §5.2). Missing `qcRunId` reaches the service `lane_qc_not_run` check. Append-only and lane_already_decided coverage added; agent scratch report removed from the branch.

## W2-01: lane open on submit — 2026-09-22

Submit now opens the three review lanes (`lane.opened` × 3 + `lane_open` notification rows) in the same transaction as the freeze. This is not the W2 exit; decisions, send-back, Ready, UI and mail delivery remain later W2/W3 tickets.

## W0 and W1 build closed: 2026-09-22

32 PRs (#57-#88) through the reviewed ticket flow. W0 exit and Milestone M1 recorded; W2 ready. [Change review](changes/2026-09-21-w0-w1-build/review.md) records what the gate caught and the process fixes for W2.

## Milestone M1: 2026-09-22

W1 exit recorded from a clean checkout of `main` ([review](changes/2026-09-22-w1-exit/review.md), PR for W1-08, issue #30). Fixture set `slice1-synthetic@1 7c80ccd43663`. `npm run verify`: 347 unit and 135 integration tests green on the real Postgres; `npm run build && npm run check:substitute-absent`: 391 files scanned, 0 with the marker; `npm run test:browser:server`: 108 evidence browser tests green (the W1-INT journey create → attach → submit → restart → reopen, the BU-SPOC positive, the promoted W1-06/W1-07 specs, the evidence-configuration check, at three widths, axe zero critical); repository checks green. The W1 exit negatives were also run explicitly against the built server and quoted: no session and a direct file URL 401, wrong role 403, other BU 403 with the HR cases absent from the CM SPOC's list, disguised executables `422 unsafe_upload` with nothing stored, `local-google` with `HOST=0.0.0.0` → `process.refused bind_not_loopback` exit 78 and with `RAI_IDENTITY_MODE=bogus` → `mode_unknown` exit 78. The restart journey was run once more by hand over the API: five bodies and the artifact bytes byte-identical across a SIGTERM and a new process; a write to the frozen version is `409 version_superseded` and a raw `UPDATE pack_version` raises `rai.frozen_version` as `rai_owner` and `rai_app`.

**What exists at M1:** one deployable (Fastify API serving the built React SPA on loopback); Postgres 16 with four forward-only migrations; the W0-04 substrate (case, immutable pack version, artifact slots, configuration revisions, append-only audit); fixture and fail-closed `local-google` identity with server-side sessions and the W0-05 policy as the only place scope is enforced; create/edit/read/list cases with `Unknown` or known source ids (never looked up); content-hash artifact store with the W0-08 upload checks and authorized download; nine-slot draft with all four dispositions, mandatory N/A reasons and the non-vendor default; submit freezing an immutable version with configuration revision, lane-mapping constant, template and stage context; the bilingual SPA (Thai default) for sign-in, case list, new case, pack editor and version navigation, keyboard-only and axe-clean; the W1-10 QC and W1-11 mail-sink substitutes at the integration layer; CI running all eleven checks on every PR.

**Pending:** the one manual step — Ta's Google sign-in through `local-google` on a loopback bind, runbook in [TESTING.md](TESTING.md#google-sign-in-on-loopback-manual-w1-08); recorded as "Google sign-in on loopback: pending Ta" until then, never with the account address. **Not claimed:** lanes, reviews, QC findings, notifications or mail sending (W2-W4); networked or production identity (W8, D10); real data (D08); substitute runs as evidence. W2 issues #31-#41 are `status:ready`; epic #52 closed; W2-01 is next.

## Build log: 2026-09-21

- W1-08 merged (PR #88): W1 exit (Milestone M1): clean-checkout evidence for A01/A02/A07 with every command and output, explicit fail-closed and scope negatives, hand-run restart journey with byte-identical bodies and download; Google-on-loopback runbook in TESTING.md pending Ta; W2 issues flipped to ready; epic #52 closed.
- W1-INT merged (PR #87): SPA served by the real server; Lane B journeys promoted to evidence against real Postgres (108 browser tests); create→attach→submit→restart→reopen journey with byte-identical download; SPOC-on-behalf positive; all exit negatives; fixed a graceful-shutdown hang on idle sockets found by the restart test; 347 unit + 135 integration.
- W1-00-w1-06-locale-contract merged (PR #86): W1-00 amendment (contract PR for W1-06): locale keys for the case overview, pack editor and version navigation.
- W1-06 merged (PR #82): Case overview, nine-slot pack editor with contained N/A-reason dialog, version navigation, integrated onto the W1-07 shell/router/client; keyboard-only and axe zero-critical at three widths; 331 unit, 390/390 repeated substitute runs.
- W1-07 merged (PR #85): React SPA shell, i18n provider (th default, en), sign-in, new-case form, own/BU case list on the W1-13 substitute; keyboard-only and axe zero-critical at 1440/834/390; 57 substitute browser tests; re-targeted onto main after #83 landed on its contract branch; main-focus checks now poll.
- W1-04 merged (PR #80): Nine-slot draft pack per 7.5: four slot states, mandatory N/A reason, slots 3/4 default N/A only when vendor_involved is false, checklist_template_version and stage_context on the draft, expectedVersion 409 rule, audit events; 285 unit + 103 integration.
- W1-13 merged (PR #79): Lint green on main: StageContextSchema spelled out as a literal tuple (byte-identical JSON schema); the substitute contract-cast helpers are identity functions.
- W1-03 merged (PR #78): Artifact upload/download per 7.4: content-hash blob store behind an interface, sniffing not extension, size limits, unresolved-id rule, Thai filenames, direct URL without session refused; store:verify/cleanup operator commands; 197 unit + 53 integration.
- W1-13 merged (PR #77): Dev/test-only in-memory API substitute serving every 7.2-7.6 shape from the fixture set with the W0-06 error envelope; absent from the production build; 61 new tests.
- W1-12 merged (PR #75): Browser job green on main: Playwright web server now builds the fixtures workspace (server refused with fixture_outside_test on clean checkouts), and the harness spec asserts the fixture sign-in route W1-01 added. Found by independent review.
- W1-09 merged (PR #72): Synthetic fixture set slice1-synthetic@1 (5 cases, 33 generated documents incl. Thai-named file, dual-role SPOC case), fixtures:generate/load, denylist test; migration renumbered to 0002 after the W1-01 collision.
- W1-10 merged (PR #69): QC substitute: scripted findings by version ref, unavailable, timeout, QC_RUNNER=none, provable no write path.
- W1-11 merged (PR #68): Mail-sink substitute: four inputs, delivery status, forced failure, dedup key, provable no external mail path.
- W1-12 merged (PR #70): CI workflow (11 jobs: unit, integration on Postgres, lint, typecheck, build, link check, frozen-source hash, demo suite, browser/Playwright) and local harness scripts; altered-snapshot hash test.
- W1-00 merged (PR #67): First code: rai-web workspaces, docker compose Postgres, Drizzle base migration (case, pack_version, artifact_slot, configuration_revision, append-only audit_event with DB trigger), shared error module, policy module, fixture identity provider, configuration seed, logger; 58 unit + 14 integration tests.
- W0-09 merged (PR #66): W0 exit: cross-spec consistency pass over all nine W0 documents (error envelope, ExpectedVersion, routes, paths, log fields, dedup key, fixtures aligned to their owners), performance targets recorded, exit checklist ticked, changes/2026-09-21-w0-exit/review.md.
- W0-05 merged (PR #58): Authorization policy matrix: role x action x scope with D05 rows, status-field projection rule, route-verbatim middleware facts, unresolved-target rule, 34+ test obligations; aligned to merged W0-02/W0-04/W0-06/W0-10.
- W0-07 merged (PR #60): QC boundary and mail sink spec: typed findings with owning lane, run keys, unavailable results, substitute with timeout; mail sink with dedup key aligned to the W0-04 notification index and W0-10 log fields.
- W0-03 merged (PR #62): Identity adapter spec: modes local-google/network/production with fail-closed start-up table S1-S18, session, fixture provider with dual-role identity, test obligations.
- W0-08 merged (PR #64): Upload safety policy and synthetic fixture strategy: allowed types, limits, sniffing rules, filename rule, hostile test rows, four fixture cases and users.
- W0-02 merged (PR #65): File-level implementation plan for W1-W3: layout, commands, pinned deps, env list, CI checks, W1 interface shapes, test-layer map, UI quality bar, language rule; architecture paths and TESTING commands filled.
- W0-04 merged (PR #61): Persistence and artifact-store spec: entities, immutability, transactions, audit log, schema evolution, retention options for D08.
- W0-06 merged (PR #63): Workflow transition and error contract: states, events, lane-mapping constant, D05 rules, owning-lane assignment, seven error types with HTTP codes.
- W0-10 merged (PR #59): Observability contract for the desk runtime: correlation IDs, redaction, readiness, error capture, operator view.
- W0-01 merged (PR #57): ADR-0003 stack and deployment boundary (D04): Fastify API serving React SPA, Postgres, Drizzle, openid-client; scored against seven criteria.

## Tracker populated: 2026-09-21

GitHub issues opened for W0-W3: four epics and 45 ticket issues from the delivery pack, with labels, milestones and dependency links; W0 is Ready. See [docs/delivery](docs/delivery/README.md#tracker-of-record-d03-github-issues).

## G0 closed: 2026-09-21

Nakhun confirmed the review-desk scope, the operator role and the DPO SLA (D01). Ta recorded D02 (BRD), D05, D06, D11 and D12 with the brief defaults and authorized W0-W3 on synthetic data (D03). The [register](docs/product/decisions.md) is restructured into recorded and open tables; every document that marked those items pending now states the rule. D04 stays inside W0-01; D07-D10 stay open. Next: W0-01 stack ADR. Nothing is built. [Change record](changes/2026-09-21-g0-close/review.md).

## Delivery planning, second pass: 2026-09-21

Reviewed the delivery pack with a 34-agent workflow (five reviewers, one skeptic per finding, one synthesis): 24 findings confirmed, 4 refuted, 14 structural items applied from the s42-ci-platform comparison. Restructured slice 1 for parallel work: W1-00 substrate, Lane C substitutes and CI, Wx-INT integration tickets, `Done when` per ticket, merge order. Added W0-10 observability, audit and schema rules, UI quality bar and language rule, build principles, delivery risks, dated status, ADR template and index, build board lanes, architecture boundary map. Ta accepted D12 as a register row and A11 as an acceptance criterion on 2026-09-21; the D12 answer (which languages) stays open. D01-D11 unchanged. See the [change review](changes/2026-09-21-delivery-planning/review.md).

## Delivery planning: 2026-09-21

Added [docs/delivery](docs/delivery/README.md). It holds decision briefs for D01-D03, D05, D06 and D11, team roles and agent limits, the W0 technical contract with stack criteria but no selection, a W1-W3 ticket breakdown traced to A01-A09, a design-to-build map and a W4-W8 outline. Documentation only. G0 is still open and W0-W8 are not started. [Change review](changes/2026-09-21-delivery-planning/review.md) records the checks.

## README journey: 2026-09-21

Added the review journey, correction loop and completion gates to README. Demo behavior and unresolved production authority remain explicit. Documentation only; [change review](changes/2026-09-21-readme-user-journey/review.md) records verification.

## Video preview: 2026-09-21

Created a 30-second True RAI product-motion video from actual demo captures, inspired by an inspected Cursor launch video. MP4 decoding and QuickTime playback verified. Assets and renderer are in [media/demo-video](media/demo-video/README.md); [review](changes/2026-09-21-demo-video/review.md) records limits. Merged through PR #3 (`824eaa7`); not posted to social media.

## Current state: 2026-09-21

The local demo's revised functional gate passed: 22 unit/provenance tests and four UI-driven localhost suites. Fixed invalid Admin publication and a discard-control regression found during retesting. Original Claude export is immutable; intentional local corrections are declared in demo/reference/local-adaptations.json. Ta accepts small visual differences, so literal raster equality is no longer a blocker. See [functional gate](changes/2026-09-21-local-design-demo/functional-gate.md). Owner authorized commit, PR and merge after the functional gate passed. Production W0–W8 remain unstarted.

## Previous state: 2026-09-20

Product anchors: [PRD](PRD.md) and [BUILD_PLAN](BUILD_PLAN.md). Build packages W0-W8 are not started.

Documentation foundation and interactive Claude Design prototype prepared. Core synthetic owner/SPOC/reviewer/admin journey browser-tested; responsive/copy corrections completed and affected paths retested. See [handoff](docs/design/DEVELOPER_HANDOFF.md) and [test evidence](docs/design/TEST_RUNS.md). Application implementation has not started. No production services, dependencies, models, data stores or deployments exist. Prototype UI observations are not application runtime acceptance.

Owner: Ta. Proposed gate operator at the time: Nakhun (confirmed under D01 on 2026-09-21). Organization-level acceptance is not established by this repository.

### Next gates as recorded on 2026-09-20 (superseded by the G0 close above)

1. Operator confirmation and AI/COE document-mapping decision.
2. Explicit Ta start instruction, followed by a stack ADR and slice-1 implementation plan.
3. Implement and prove one synthetic case end to end, then add evaluated QC, risk proposal, admin controls and operator rehearsal.

That [change review](changes/2026-09-20-documentation-foundation/review.md) records documentation verification at the time.

## Next gates

1. W0-01 stack and deployment-boundary ADR (D04), then W0-02 file-level plan with paths, commands and CI checks, through W0 exit.
2. W1-00 substrate, then slice 1 (W1-W3) on synthetic data, authorized by D03: prove one synthetic case end to end.
3. D07-D10 before W4-W8: evaluated QC, risk proposal, admin controls, operator rehearsal and release remain gated.

The [G0 close record](changes/2026-09-21-g0-close/review.md) records the verification. The [decision register](docs/product/decisions.md) owns the open items.

## W2-INT: real-server journey and negatives — 2026-09-22

W2-07/W2-09 wired to the real server: promoted evidence browser specs, the automated W2 journey (v1 → send-back → v2 → disposition → three approvals → Ready), and the W2 exit negatives (concurrent send-back, stale approval, undispositioned finding, Admin and self-approval 403s) against the built deployable and fixture set slice1-synthetic@1. The deployable binds the W1-10 ScriptedQcRunner via dynamic import when `QC_MODE=substitute` so lane QC findings exist on the real server; W2-10 API substitute specs remain for Lane B/W3 and stay out of the evidence app path. Not the W2 exit (W2-08 runs this suite and records evidence). Issue #35 stays open.

## W3-07a prerequisite contract — 2026-09-22

Isolated branch from 5fe59ad; shared observability schemas and additive migration 0007 only. [Plan](changes/2026-09-22-w3-07a-observability-contract/plan.md) and [contract](changes/2026-09-22-w3-07a-observability-contract/spec.md). No consumer implementation or OBS acceptance claimed; parent reviews before any publication.
