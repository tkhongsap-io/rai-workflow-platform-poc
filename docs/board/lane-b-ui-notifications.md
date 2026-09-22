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
