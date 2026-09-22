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

## 2026-09-22 — CLAIM Lane B: W3-04 pure retry slice only
- Author: operator=ta session=codex-w3-04-retries model=GPT-6
- Takes over from: session=none for W3-04 (reason: explicit scoped assignment; Hypatia retains W3-03a)
- What: Issue #45 pure retry policy/tests in `/tmp/rai-w3-retries` from main `5fe59ad`; no composition or worker integration until parent supplies committed W3-03a. No push/merge; no other worktree writes. Future isolated DB port 54365 only.
- Evidence: [W3-04 plan](../../changes/2026-09-22-w3-04-retries/plan.md)

## 2026-09-22 — W3-04 integration preparation
- Author: operator=ta session=codex-w3-04-retries model=GPT-6
- What: Parent supplied committed W3-03a `36dcee9`; integrate retry dispatch only in `/tmp/rai-w3-retries`, preserving Hypatia's composition. Review fixes and final dependency rebase remain parent-coordinated. Isolated DB 54365.
- Evidence: [integration plan](../../changes/2026-09-22-w3-04-retries/plan.md)

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

## 2026-09-22 (time not recorded) — CLAIM W3-03b digest consumer
- Author: operator=ta session=w3-03b-digest-consumer model=codex
- Scope: producer, persisted-provenance loader, standalone local scheduling hook and tests; dispatcher binding awaits parent confirmation. No other lane takeover.
- Evidence: changes/2026-09-22-w3-03b-digest-consumer/plan.md
