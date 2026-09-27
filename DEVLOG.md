# Development log

## W4-03 deterministic runner — 2026-09-27

Third W4a ticket (#186). The desk now has a real QC runner, `deterministic`, that reads only structured pack data (slot states, stage, vendor flag) and never a document. It runs the three provisional W4a rules from the rule catalogue: a missing single-lane document on submit, a missing slot 5 on each lane's approve attempt (owned by that lane), a pack that does not fit its stage, and, new, a DPA or SOW marked not applicable on a vendor case (for the DPO to confirm). A version without a rule catalogue gets an outage, never a clean pass, and only the rules actually run are counted. Tests show it never reads document bytes and imports no parser or network code. A test-only setting (`QC_MODE=deterministic`, accepted only in the test environment) lets a new real-server test start the whole server with this runner and check its findings over HTTP; W4-13 makes the setting real. Every other suite and screen still uses the scripted substitute and behaves as before. Rules are provisional until D09. [Review](changes/2026-09-27-w4-03-deterministic-runner/review.md).

## W4-02 rule catalogue — 2026-09-27

Second W4a ticket (#185). The `qc_rules` configuration now holds a real rule catalogue per checklist template version, and the seed publishes revision 1 (label `w4a.1`): the three provisional metadata rules W4-03 will run, plus the four accuracy rules catalogued for W4b. Template v2.0 never gets the v1.0 Sheet-3 bands. QC now sends the runner the rules its recorded revision selects for the template, trigger and model type. A version submitted before this change has no rule catalogue and gets no rules, which the deterministic runner will report as an outage, never a clean pass. An unknown template version is an outage too. New submits now record the rule catalogue's revision as their configuration revision. The scripted substitute used by the test suites ignores the rules, so nothing a user sees changes yet. [Review](changes/2026-09-27-w4-02-rule-catalogue/review.md).

## W4-11a run identity — 2026-09-27

First W4a ticket (#184). Every new `qc_run` row now records the runner's version beside its name and how many rules it evaluated (migration 0009; older rows read `unrecorded` and no count). The `qc.run.*` log lines name the runner, its version and the rule revision, and the QC kind comes from the bound runner instead of a constant. The Admin desk-health list of QC outages carries the runner label. Two runs on one version under different rule revisions can now be told apart from rows and logs alone. No rule, runner or screen changes. [Review](changes/2026-09-27-w4-11a-run-identity/review.md).

## W4a opened; W4-00a plan — 2026-09-26

Ta opened W4a: QC that reads only structured pack data (no document parsing, no model), on synthetic data, ahead of D08 and D09. Also recorded: an upload QC outage on slot 5 is AI/COE's, and slot 9 gets no upload run; the API substitute is kept through W4a; the four provisional rules are the W4a starting set. The [W4-00a plan](docs/engineering/implementation-plan-w4a.md) sets the order W4-11a, W4-02, W4-03, W4-13, W4-04, W4-12, then the W4a exit, each through a reviewed PR with the full suite. W4b stays gated on named owners, D08 and D09. [Review](changes/2026-09-26-w4-00a-plan/review.md).

## W3 follow-ups closed — 2026-09-26

All seven follow-ups from Ta's W3 deferred rulings are merged: display names (F1, #163), no lane-opened mail to a BU-SPOC reviewer (F2, #164), per-lane finding count (F3, #165), send-back link to the case page (F4, #166), one Thai term for desk completion (F5, #167), `scopedCases` removed (F6, #168) and the one-hour temp-file floor (F7, #169). Each merged with two independent reviewer verdicts and green CI on its merged head. CI was blocked for part of the day by a GitHub Actions spending limit on the organization; nothing merged until it was raised and CI ran green. W3-F8 (#180, PR #181) is in review in a separate session. Open for Ta, not blocking: a Thai Ready card shows the term twice; the BU-SPOC reviewer in the SLA digest; the owner-as-reviewer mail case; the queue as a day-start list.

## W3-F5 one Thai term for desk completion — 2026-09-26

Desk completion reads "การตรวจทานในระบบเสร็จสิ้น" on every Thai surface: the status badge, next action, decided-Ready message, stale-version guidance and the Ready mail (status-name ruling, ticket #167). English is unchanged. [Review](changes/2026-09-26-w3-f5-thai-desk-complete/review.md).

## W3-F4 send-back mail opens the successor draft — 2026-09-26

The owner's send-back mail now links to the case page, which shows the open successor draft and its feedback, instead of the version that was sent back (ruling item 12, ticket #166). The committed outbox row stores the same path. The SPA has no draft-specific URL, so the link names the case, not the draft id; the W3-F4 row has a dated note. [Review](changes/2026-09-26-w3-f4-send-back-link/review.md).

## W3-F7 BLOB_TMP_MAX_AGE_HOURS minimum 1 — 2026-09-26

`BLOB_TMP_MAX_AGE_HOURS` below 1 is refused at start-up and by `store:cleanup`, so the sweep cannot remove an upload younger than an hour (ruling item 7, ticket #169). W0-02 section 5 says "Integer ≥ 1"; W0-04 records the floor. [Review](changes/2026-09-26-w3-f7-blob-tmp-min/review.md).

## W3-F3 lane-opened mail counts that lane's findings — 2026-09-26

The lane-opened mail now counts only that lane's findings, recorded when the delivered mail is composed, and says "findings recorded so far" in both languages (ruling item 11, ticket #165). A QC-unavailable finding counts too, so an outage never reads as 0; dispositioned findings still count. [Review](changes/2026-09-26-w3-f3-lane-defect-count/review.md).

## W3-F6 remove unused scopedCases — 2026-09-26

The unused `scopedCases` sub-select helper is gone (ruling item 5, ticket #168); W0-04, W0-05 and the performance targets now name `caseScopeWhere`, the predicate every list query actually uses. No behaviour change; full suite unchanged. [Review](changes/2026-09-26-w3-f6-remove-scoped-cases/review.md).

## W3-F2 BU-SPOC reviewer mail and page note — 2026-09-26

A lane reviewer who is BU SPOC of a case's business unit no longer gets that case's lane-opened mail, and the case page tells them why they have no decision panel, in Thai and English (ruling item 10, ticket #164). On a case of another business unit the same reviewer still gets the mail. The owner case is not ruled and is unchanged. [Review](changes/2026-09-26-w3-f2-spoc-reviewer-mail/review.md).

## W3-F1 display names, part 2 — 2026-09-26

The case header, the My cases card, the version list, the frozen version and the lane decisions (including the owner's send-back feedback) now show names instead of subject IDs such as `fixture:fx-user-owner-cm`, falling back to the ID when a read carries no name, in Thai and English, with a test pinning each surface. This completes ticket #163. Correction to part 1's entry below: its byte identity holds in fixture mode; with a sign-in directory a name can change over time (display only, a W7 follow-up), as W0-02 now says. [Review](changes/2026-09-26-w3-f1-display-names/review.md).

## W3-F1 display names, part 1 — 2026-09-26

Case, version and decision reads now carry display names beside the subject IDs (ruling item 8, ticket #163): the owner from the case's `business_owner` column, the submitter and decider from the server's subject directory. The submit 201, its replay and every read stay byte-identical (A07). No new endpoint, no names in logs, no scope change. The UI renders them in part 2. [Review](changes/2026-09-26-w3-f1-display-names/review.md).

## W3 deferred rulings — 2026-09-26

Ta ruled on the questions the W3 hardening review had left open and on the walkthrough's status-name question (register row "W3 deferred rulings"); the "queue as a day-start list" question stays open. W0-07 now states the refusing behaviour for QC evidence after a send-back, which the code already had. Seven follow-up tickets are open under package W3 (#163-#169): display names, three notification fixes, one Thai term for desk completion, and two small clean-ups. [Review](changes/2026-09-26-w3-deferred-rulings/review.md).

## W3-07 follow-up: desk-health owning lane — 2026-09-26

The Admin desk-health list now names the lane that owns each QC outage (W0-06 7.2, derived from the run), closing the follow-up W2-05 recorded. Tests pin a DPO approve-attempt outage and a real submit timeout (AI/COE). 582 unit, 329 integration, 193 + 48 browser. [Review](changes/2026-09-26-desk-health-owning-lane/review.md).

## W3 accepted — 2026-09-26

Ta accepted W3 (slice 1) after the synthetic walkthrough with Nakhun, who asked for no changes ([notes](changes/2026-09-26-nakhun-walkthrough/notes.md)). Milestone M3 is reached and epic #54 closes. The script's four product questions stay open, as do confirmation of the advisory workload and latency targets and the manual Google loopback sign-in; none blocks. W4-W8 stay unauthorized. Next: decision briefs for D08 and D09 and a draft W4 gate for Ta, in parallel with the W3-07 desk-health follow-up (the outage finding's lane).

## W2-05 owning-lane rule (#35) — 2026-09-25

Ta accepted the five recommendations of the [#35 decision brief](changes/2026-09-23-w3-hardening/issue-35-decision-brief.md) and approved the register row "D05 refinement (#35)": slot 5 belongs to the lane whose QC rule raised the finding (on an approve attempt, that run's lane); slot 9 is informational, QC raises no defect there; the pack belongs to AI/COE; a QC-unavailable finding follows the run (the approving lane, or AI/COE on submit); nothing is carried to N+1. W0-06 sections 7.1-7.4 and W0-07 3.4-3.9 now state the rule.

- **Behaviour changes:** an unavailable QC run stores the W0-07 3.6 `QC-UNAVAILABLE` finding, owned by the lane that saw it and appended once per open scope, so a case can no longer reach Ready after an outage until that lane dispositions it (A08); the run body and the reviewer workspace show the finding under the outage notice; a runner defect on slot 9 or outside the approving lane fails the run closed; the W1-10 substitute carries one slot-5 and one pack-level finding on `fx-case-missing-slot`. No migration. With no runner bound, every submit and approve attempt now yields such a finding (W0-07 3.6 as written).
- **Code:** `owningLaneRule` and `unavailableOwningLane` replace `owningLaneForSlot`; `checkOwningLane` takes the run's lane; `owning_lane_rule_pending` and `refinement_pending` are gone.
- **Verification** in the worktree, serially on its own Postgres: lint, typecheck, 582 unit, 329 integration, 193 real-server browser, 48 substitute browser, 22 + 18 repository tests, 804 links, source hash; all green, no skips. [Review](changes/2026-09-25-w2-05-owning-lane/review.md).

Issue #35 and epic #53 close on merge. Ta's W3 package review and the Nakhun walkthrough are unchanged; the [walkthrough script](changes/2026-09-23-w3-hardening/walkthrough-script.md) notes the new outage finding. W4-W8 are not authorized.

## W3 hardening H1-H29 — 2026-09-25

Most W2/W3 PRs (#90-#126) had merged without an independent review verdict. On Ta's instruction a retro-review of `main` at `d815a8e` confirmed 71 findings (5 high) and refuted 17. Batches H1-H23 (#128-#150) closed 67 of them, three with a leftover part deferred. Three were deferred to Ta and one was withdrawn. H24 (#151) fixed what the final verification found. H25-H29 (#152-#156) fixed defects found by running the Nakhun walkthrough for real. They include a false "Action failed" after a successful send-back, and send-back feedback that reached the owner only by mail. The feedback is now on the version read (a contract PR) and shown on the owner's successor draft. Also fixed: a duplicate lane-QC request that could make an approve 409, the draft editor being offered to users who cannot edit, and a focus race after lane decisions that was already on `main`. Each batch went through the full suite, two independent reviewer verdicts on the PR and green CI on the reviewed head. #136 had one reviewer before merge and a second after; see the review record.

- **Behaviour changes:**
  - approve must name the latest lane-QC run (H2);
  - QC fails closed, recording the run unavailable, when a finding has no mappable lane (H7), so #35 stays undecided;
  - Ready checks self-approval against the approver's grants at decision time (H8, migration 0008);
  - a `Sec-Fetch-Site` guard on every signed-in write (H6);
  - pool idle-error handling and fatal process handlers (H4);
  - readiness returns 503 while migrations are pending (H10);
  - an idempotency-key race returns 422 instead of 500 (H17);
  - the reviewer workspace shows every stored finding of its lane (H5).
- **Simplification** (`d815a8e` to `4522074`): non-test source −609 lines, tests −889. Each helper the retro named as duplicated now has one definition. `runQc` went from 227 lines to 58.
- **Final verification** on a clean checkout of `4522074` passed 580 unit, 316 integration, 181 real-server browser, 48 substitute browser and 40 repository tests, with no skips.
- **Deferred for Ta:** #35 and the QC-after-send-back spec conflict, among others. H15's guard-removal finding was withdrawn: the performance harness guard stays.
- **Hand-off:** a [walkthrough script](changes/2026-09-23-w3-hardening/walkthrough-script.md) for Nakhun and a [#35 decision brief](changes/2026-09-23-w3-hardening/issue-35-decision-brief.md).

Details: [review](changes/2026-09-23-w3-hardening/review.md). W3 acceptance remains Ta's; W4-W8 are not authorized.

## W3 synthetic engineering exit — 2026-09-23

All nine W3 engineering tickets, including W3-INT and W3-06, are merged. PR #125 delivered main `e62b669ab2aa36a3e4343a095b5bedcd9e159c19`; [actual-main CI](https://github.com/tkhongsap-io/rai-workflow-platform-poc/actions/runs/35781574925) passed all 12 checks. The final run passed 565 unit, 293 integration, 174 real-server browser, 171 separate UI rehearsal and 40 repository tests. The [exit review](changes/2026-09-23-w3-exit/review.md) records the independently reviewed delivery, supplementary keyboard recording and 3,760-sample advisory performance baseline.

Ta’s package review remains pending under epic #54. Workload/target confirmation, manual Google sign-in and finding-ownership issue #35/epic #53 remain open; W4–W8 are not authorized. This is a synthetic engineering exit, not operator or production acceptance.

The dated entries below preserve preparation-time results and outstanding work as recorded then. Final delivery resolves their W3 engineering review/CI dependencies; it does not replace their source-attributed evidence or erase the PR120 merge-process exception.

## W3-INT: integrated synthetic review journey — 2026-09-23

The real-server assembly connects queue discovery, committed notifications/retries, submit-trigger QC and Admin diagnostics. API-substitute selection is removed from application configuration; historical UI rehearsals remain isolated in their test-owned harness. One keyboard-driven synthetic case covers upload, submit, process restart, queue and protected mail links, send-back, successor submission, disposition and three-lane completion. Real worker failures and a submit timeout are checked through the Admin page at three widths.

The completed full run at `2ed4fd2` passed 536 unit, 280 integration, 168 real-server browser and 171 UI rehearsal tests, zero skips, plus 40 repository checks. Subsequent review added durable late-QC/restart proof, stopped test servers before fixture resets, and retained captured logs through child close. The notification regression now waits for committed delivery state across concurrent workers without retrying delivery or weakening content checks. At `8ee4ba4`, all 291 integration tests passed with zero skips. Independent browser verification at `d8ed4a3` passed 168 tests, but walkthrough inspection exposed a false QC error after Ready. The UI repair reads persisted findings without mutation controls and refreshes state after a disposition completes review; both old failures were reproduced before 538 unit and 18 focused browser checks passed. At assembled `27ad01b`, 538 unit and 171 UI rehearsal tests passed; Carver independently passed all 174 real-server browser tests across three widths. Hypatia cleared the repair with 14 independent pure checks. The fresh desktop walkthrough was sampled and shows completed read-only evidence without the previous false alert. Earlier passing and failed runs are separately recorded; final published-head CI remains the merge gate. Exact source identities and commands are recorded in [the integration review](changes/2026-09-22-w3-int/review.md). Fresh CI exposed two missing-build prerequisites; the test-only bootstrap repair was independently reviewed and a clean-output integration run at `3e9228` passed all 293 tests with zero skips. The failed CI run remains recorded; fresh final-head CI still gates merge. This is synthetic engineering evidence; W3-06 timing/walkthrough exit review and owner acceptance remain separate. No owning-lane decision for #35, real QC, external mail or W4 authorization is implied.

## W3-07b: Admin operator UI finalization — 2026-09-23

Replayed only the reviewed UI consumer and its review record onto main `4fa14d6`, after API #123 merged. The resulting `rai-web` tree exactly matches the combined full-verification tree: 530 unit, 256 integration, 126 real-server browser and 171 substitute browser tests passed, zero skips. The page provides bilingual read-only diagnostics, manual refresh and immediate removal of stale Admin data after session changes. Controlled operator browser rehearsals remain separate from real OBS-17 acceptance in W3-INT. Delivery resolution: PR #119 merged as `a0d4287e7811`; real-server operator proof was subsequently integrated in PR #124 and included in the final PR #125 CI above. See `changes/2026-09-22-w3-07b-operator-ui/review.md` for exact provenance and focused checks.

## W3-07a: operator runtime and correlation — 2026-09-23

Health/readiness and Admin-only desk-health routes use the actual configured dependencies. Safe error capture, mail failure and QC diagnostics preserve correlation without logging submitted content. Independent reviews are clean after fixes for health-cookie isolation, readiness transition severity/frequency and response timing. Full combined verification passed; remaining package-level OBS and journey proof stays with W3-INT.

## W3-03b: daily SLA digest — 2026-09-22

The local daily producer freezes its Bangkok day, persists job provenance and queues each configured recipient once per day. Empty results send no mail. The existing retry worker delivers the digest, with recovery retaining original provenance. Core and binding reviews are clean; integrated operator/journey evidence remains pending.

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

## W3-07a runtime-only assembly — 2026-09-23

Assembled against actual main e37fb4f; complete rai-web tree equals reviewed c98ad3e (528 unit / 256 integration / 126 real browser / 123 substitute, zero skips). Runtime-only diff excludes merged prerequisite implementations; parent assesses its bounded size before publication. No PR/push from this worker, no new runner or owning lane. W3-INT owns trigger binding; see changes/2026-09-22-w3-07a-observability-api/review.md for focused checks and remaining acceptance boundaries.
