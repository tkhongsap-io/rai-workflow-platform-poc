# Build board — Lane B: UI and notifications

See [README](README.md) for the convention. Append-only; record corrections as new entries.

## 2026-09-21 (time not recorded) — Stream opened
- What: Stream created with the delivery pack. Not started; blocked by G0 (D01-D03).
- Why: One pen-holder per lane once Ta gives the start instruction.
- Next: Ta records D01-D03; then the lane holder appends a CLAIM.
- Author: operator=ta session=planning-session model=claude-fable-5-1
- Evidence: changes/2026-09-21-delivery-planning/

## 2026-09-21 (time not recorded) — W1-07 merged
- What: React SPA shell, i18n provider (th default, en), sign-in, new-case form, own/BU case list on the W1-13 substitute; keyboard-only and axe zero-critical at 1440/834/390; 57 substitute browser tests; re-targeted onto main after #83 landed on its contract branch; main-focus checks now poll. PR #85.
- Why: Ticket W1-07 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/85

## 2026-09-21 (time not recorded) — W1-06 merged
- What: Case overview, nine-slot pack editor with contained N/A-reason dialog, version navigation, integrated onto the W1-07 shell/router/client; keyboard-only and axe zero-critical at three widths; 331 unit, 390/390 repeated substitute runs. PR #82.
- Why: Ticket W1-06 of the delivery pack; two independent reviewer agents passed before merge.
- Next: next ticket in the dependency map.
- Author: operator=ta session=build-workflow model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/82

## 2026-09-22 12:53 — CLAIM Lane B
- Author: operator=ta session=w2-05 model=composer
- Takes over from: session=none (reason: new)

## 2026-09-22 12:53 — W2-05 findings and dispositions (single-lane)
- What: Migration 0006 (`qc_run`, `qc_finding`, `disposition_event` append-only); lane QC run persists single-lane defects from the injected W1-10 substitute; disposition append-only under D05 (owner proposes, owning lane confirms/waives/N/A/fixed). Unavailable / slot-5 / pack / slot-9 findings are not stored (W0-06 §7.4). #35 stays open. Not the W2 exit; Ready is W2-06.
- Why: Ticket W2-05 (#35); proves A09 for the single-lane case; D05. Doc wins over the issue's slot-5/pack/unavailable done-when until §7.3 is recorded.
- Next: W2-06 Ready predicate — not this session; Lane B UI (W2-07/W2-09) later.
- Author: operator=ta session=w2-05 model=composer
- Evidence: branch codex/w2-05-dispositions

## 2026-09-22 14:55 — CLAIM Lane B
- Author: operator=ta session=w2-07 model=composer
- Takes over from: session=w2-05 (reason: W2-07 reviewer workspace)

## 2026-09-22 14:55 — W2-07 reviewer workspace UI
- What: Reviewer workspace on a submitted version: lane QC findings before approve/send-back; send-back dialog requires a named artifact slot; frozen version history unchanged after send-back; Admin/owner/wrong lane/stale versions get no decision controls. Keyboard-only substitute Playwright path; axe zero critical and zero serious. Locale keys in th.json and en.json for the new copy. Not the W2 exit; disposition UI is W2-09.
- Why: Ticket W2-07 of the delivery pack; proves A09/A07 for the UI layer on the W2-10 substitute.
- Next: W2-09 findings/disposition UI; W2-INT wires to the real server.
- Author: operator=ta session=w2-07 model=composer
- Evidence: branch codex/w2-07-reviewer-workspace

## 2026-09-22 15:46 — CLAIM Lane B
- Author: operator=ta session=w2-09 model=composer
- Takes over from: session=w2-07 (reason: W2-09 disposition UI)

## 2026-09-22 15:46 — W2-09 findings and disposition UI
- What: Disposition UI on the reviewer workspace. Owning-lane reviewer: qc-run then GET …/findings for latestDisposition; fixed_confirmed when that kind is fixed_proposed. Owner/BU SPOC: GET …/findings (version.view, no qc_run write) with propose-fixed only. Waived/N/A require the reason dialog. After each disposition POST the GET is refetched. Every kind is reachable on the substitute. qc-run auth unchanged. Issue #35 stays open. Locale keys in th.json and en.json. Not the W2 exit.
- Why: Ticket W2-09 of the delivery pack; proves A09 for the disposition UI layer on the W2-10 substitute. Spec fix: GET makes propose/confirm reachable without weakening qc-run.
- Next: W2-INT wires to the real server.
- Author: operator=ta session=w2-09 model=composer
- Evidence: branch codex/w2-09-disposition-ui

## 2026-09-22 16:58 — CLAIM Lane B
- Author: operator=ta session=w2-int model=composer
- Takes over from: session=w2-09 (reason: handoff; W2-INT real-server journey)


## 2026-09-22 16:58 — W2-INT real-server journey (Lane B half)
- What: W2-07/W2-09 promoted to real-server evidence specs; W2 journey drives send-back, disposition and Ready through the UI (keyboard + axe, Thai, three widths). No Deploy control; no new ready route. Issue #35 stays open. Not the W2 exit.
- Why: Ticket W2-INT (#40); proves A04, A07, A09 at the browser layer on the real server.
- Next: W2-08 exit evidence (Lead) — not this session.
- Author: operator=ta session=w2-int model=composer
- Evidence: branch codex/w2-int-real-server-journey

## 2026-09-22 — CLAIM Lane B: W3-02 queue UI
- Author: operator=ta session=codex-w3-02-queue-ui model=GPT-6
- Takes over from: session=w2-int (reason: parent delegates queue UI in isolated worktree)
- What: /tmp/rai-w3-queue-ui at edb5d89; first additive UI contract commit, then implementation against substitute only. No server/DB, push, PR or merge.
- Evidence: [plan](../../changes/2026-09-22-w3-02-queue-ui/plan.md)

## 2026-09-22 (time not recorded) — CLAIM Lane B: W3-03a only
- Author: operator=ta session=w3-03a-notifications model=gpt-6
- Takes over from: session=w2-int (reason: handoff; owner assigns notification composer only)
- What: W3-03a issue #44 approved split, on `codex/w3-03a-notifications` from `44c5517`; queue UI and other Lane B tickets outside claim.
- Next: Shared locale prerequisite, composer and initial local sink attempt, tests, local commit; parent arranges independent review and PR.
- Evidence: [plan](../../changes/2026-09-22-w3-03a-notifications/plan.md)

## 2026-09-22 — CLAIM Lane B: W3-07b operator UI planning only
- Author: operator=ta session=codex-w3-07b-operator-ui model=GPT-6
- Scope: owner-assigned parallel slice under #48; operator page planning only in `/tmp/rai-w3-operator-ui`, branch `codex/w3-07b-operator-ui`, base `89f7de9`. Does not take over or edit the active W3-02 queue UI slice.
- Boundaries: change documents and this scoped claim only. No shared/UI code until parent provides the committed W3-07a contract. No server, fixture endpoint, migration, database, push, PR or merge.
- Next: reconcile the committed W3-07a types, then prepare a separate shared locale/routes/client prerequisite before the consumer.
- Evidence: [operator UI plan](../../changes/2026-09-22-w3-07b-operator-ui/plan.md)

## 2026-09-22 — W3-07b UI prerequisite authorized
- Author: operator=ta session=codex-w3-07b-operator-ui model=GPT-6
- What: Parent accepted the plan and supplied W3-07a schema commit `d931cea` with combined base `9980c7e`. Planning work is preserved on `codex/w3-07b-operator-ui`; first local commit is locale/routes/client contract, consumer follows separately.
- Boundaries: Admin presentation guard and session isolation in consumer; no automatic refresh, new permissions, API handler guesses, database, push, PR or merge. Rehearsal browser ports reserved: 60788, substitute 60789, web 60175.
- Next: report the verified prerequisite commit to parent before consumer implementation; real OBS-17 stays with W3-INT.
- Evidence: [plan](../../changes/2026-09-22-w3-07b-operator-ui/plan.md)

## 2026-09-22 (time not recorded) — CLAIM W3-03b provenance planning only
- Author: operator=ta session=w3-03b-provenance-plan model=codex
- Scope: separate documentation-only proposal; no consumer or shared-code edits, no takeover of other Lane B work.
- Evidence: changes/2026-09-22-w3-03b-provenance-proposal/plan.md
- Next: parent reviews proposed mail/sink boundary against W3-07a aabee4c before implementation.

## 2026-09-22 (time not recorded) — W3-03b shared provenance implementation authorized
- Author: operator=ta session=w3-03b-provenance-plan model=codex
- What: parent accepted proposal; isolated branch rebased onto W3-07a d931cea. Implemented shared mail union and synthetic sink validation only.
- Evidence: changes/2026-09-22-w3-03b-provenance-proposal/review.md
- Next: independent contract review; no consumer before parent coordinates W3-04 integration.
## 2026-09-22 — CLAIM Lane B: W3-04 pure retry slice only
- Author: operator=ta session=codex-w3-04-retries model=GPT-6
- Takes over from: session=none for W3-04 (reason: explicit scoped assignment; Hypatia retains W3-03a)
- What: Issue #45 pure retry policy/tests in `/tmp/rai-w3-retries` from main `5fe59ad`; no composition or worker integration until parent supplies committed W3-03a. No push/merge; no other worktree writes. Future isolated DB port 54365 only.
- Evidence: [W3-04 plan](../../changes/2026-09-22-w3-04-retries/plan.md)

## 2026-09-22 — W3-04 integration preparation
- Author: operator=ta session=codex-w3-04-retries model=GPT-6
- What: Parent supplied committed W3-03a `36dcee9`; integrate retry dispatch only in `/tmp/rai-w3-retries`, preserving Hypatia's composition. Review fixes and final dependency rebase remain parent-coordinated. Isolated DB 54365.
- Evidence: [integration plan](../../changes/2026-09-22-w3-04-retries/plan.md)

## 2026-09-22 (time not recorded) — CLAIM W3-03b digest consumer
- Author: operator=ta session=w3-03b-digest-consumer model=codex
- Scope: producer, persisted-provenance loader, standalone local scheduling hook and tests; dispatcher binding awaits parent confirmation. No other lane takeover.
- Evidence: changes/2026-09-22-w3-03b-digest-consumer/plan.md

## 2026-09-25 20:05 — CLAIM lane-b: W2-05 owning-lane rule (#35)
- Author: operator=ta session=claude-code-w2-05-owning-lane model=claude-fable-5-1
- Takes over from: session=none (reason: new; the ticket was status:ready and blocked on W0-06 7.3)
- Scope: the rule Ta accepted on 2026-09-25, per changes/2026-09-25-w2-05-owning-lane/. One PR.

## 2026-09-25 22:30 — W2-05 owning-lane rule implemented (#35)
- What: Ta accepted the five #35 recommendations and approved the register row "D05 refinement (#35)". One rule function replaces the pending placeholder; the QC boundary enforces it with the run's lane; an outage stores the QC-UNAVAILABLE finding owned by the lane that saw it, once per open scope, and Ready waits for that lane's disposition; the W1-10 substitute carries one slot-5 and one pack-level finding; W0-06 7.1-7.4 and W0-07 3.4-3.9 state the rule.
- Why: W2-05's done-when named a slot-5, a pack-level and an unavailable case that were blocked on W0-06 7.3; the hardening walkthrough showed a case reaching Ready after a QC outage.
- Next: reviewer verdicts and CI on the PR; on merge close #35 and epic #53 and mark W2-05 evidence-recorded. Ta's W3 package review and the Nakhun walkthrough are unchanged; the walkthrough script notes the new outage finding.
- Author: operator=ta session=claude-code-w2-05-owning-lane model=claude-fable-5-1
- Evidence: changes/2026-09-25-w2-05-owning-lane/review.md; PR on `codex/w2-05-owning-lane`

## 2026-09-26 14:20 — CLAIM lane-b: W3-F2 BU-SPOC reviewer mail and page note (#164)
- Author: operator=ta session=claude-code-w3-f2-spoc-reviewer-mail model=claude-opus-5-5
- Takes over from: session=none (reason: new; ticket #164, human-review-required)
- Scope: per changes/2026-09-26-w3-f2-spoc-reviewer-mail/. One PR.

## 2026-09-26 15:30 — CLAIM lane-b: W3-F3 lane-opened mail counts that lane's defects (#165)
- Author: operator=ta session=claude-code-w3-f3-lane-defect-count model=claude-opus-5-5
- Takes over from: session=none (reason: new; ticket #165)
- Scope: per changes/2026-09-26-w3-f3-lane-defect-count/. One PR.

## 2026-09-26 16:40 — CLAIM lane-b: W3-F4 send-back mail opens the successor draft (#166)
- Author: operator=ta session=claude-code-w3-f4-send-back-link model=claude-opus-5-5
- Takes over from: session=none (reason: new; ticket #166)
- Scope: per changes/2026-09-26-w3-f4-send-back-link/. One PR.

## 2026-09-26 17:00 — CLAIM lane-b: W3-F5 one Thai term for desk completion (#167)
- Author: operator=ta session=claude-code-w3-f5-thai-desk-complete model=claude-opus-5-5
- Takes over from: session=none (reason: new; ticket #167)
- Scope: per changes/2026-09-26-w3-f5-thai-desk-complete/. One PR.

## 2026-09-27 13:51 — CLAIM lane-b: W4-12 QC log, evidence and unavailable runs in the UI (#189)
- Author: operator=ta session=claude-code-w4-12-qc-log-ui model=claude-opus-5-5
- Takes over from: session=none (reason: new; ticket #189)
- Scope: per changes/2026-09-27-w4-12-qc-log-ui/: finding read shapes gain `evidence` (locators only), `GET …/versions/{versionId}/qc-runs` scoped like the findings read, the QC log on the version view, every unavailable run before the decision controls, rule label, rule ID, evidence location and owning lane on a finding row, W0-02 section 7 amendment. One PR.

## 2026-09-28 02:41 — CLAIM lane-b: W5-07 Questionnaire UI in the pack editor (#230)
- Author: operator=ta session=claude-code-w5-07-questionnaire-ui model=claude-opus-5-5
- Takes over from: session=none (reason: new; ticket #230)
- Scope: per changes/2026-09-27-w5-07-questionnaire-ui-in-the/: the risk questionnaire in the pack editor (seven radio groups, Unknown, clear, evidence hint, live non-recorded preview), the placeholder rubric banner, the rubric read in the API client (404 renders "not configured"), the in-memory substitute's rubric read (R-16), `risk.*` locale keys. One PR.

## 2026-09-28 04:39 — CLAIM lane-b: W7-09 sign-in method endpoint and UI (#218)
- Author: operator=ta session=claude-code-w7-09-sign-in-method-endpoint model=claude-opus-5-5
- Takes over from: session=none (reason: new; ticket #218)
- Scope: per changes/2026-09-27-w7-09-sign-in-method-endpoint/: public `GET /auth/sign-in-method` (`fixture` | `google` | `organization`, no issuer, client or tenant value), the sign-in screen's provider button and note labelled from it, new th/en keys, W0-02 section 7.2 amendment. One PR.

## 2026-09-28 07:08 — CLAIM lane-b: W6-15 Dashboard UI (#232)
- Author: operator=ta session=claude-code-w6-15-dashboard-ui model=claude-opus-5-5
- Takes over from: session=none (reason: new; ticket #232)
- Scope: per changes/2026-09-27-w6-15-dashboard-ui/: the `/dashboard` screen over `GET /api/dashboard` (status, lanes and SLA, findings, QC, risk and activity tiles as captioned tables with aria-hidden bars), every non-zero countable number linked to its W6-14 queue drill-down, empty state, "Dashboard" first in the primary navigation, `dashboard.*` locale keys (th and en), browser `w6-15-dashboard.spec.ts`. One PR.
