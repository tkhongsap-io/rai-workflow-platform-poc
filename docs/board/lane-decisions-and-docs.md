# Build board — Decisions and documents

See [README](README.md) for the convention. Append-only; record corrections as new entries.

## 2026-09-21 (time not recorded) — Stream opened
- What: Stream created with the delivery pack. Not started; blocked by G0 (D01-D03).
- Why: One pen-holder per lane once Ta gives the start instruction.
- Next: Ta records D01-D03; then the lane holder appends a CLAIM.
- Author: operator=ta session=planning-session model=claude-fable-5-1
- Evidence: changes/2026-09-21-delivery-planning/

## 2026-09-21 (time not recorded) — Delivery pack reviewed and restructured
- What: Two multi-agent workflow runs reviewed and verified docs/delivery; 45 confirmed findings applied. Proposed D12 and A11 raised for Ta; no decision recorded.
- Why: Ta asked for a contradiction check, parallel work breakdown and s42-style planning structure before delegation.
- Next: Ta reviews the pack and decides D12/A11 acceptance; G0 meeting with Nakhun.
- Author: operator=ta session=planning-session model=claude-fable-5-1
- Evidence: changes/2026-09-21-delivery-planning/review.md

## 2026-09-21 (time not recorded) — D12 row and A11 accepted
- What: Ta accepted D12 (language) as a register row and A11 (audit reconstructability) as an acceptance criterion. The D12 answer is still open.
- Why: Both were raised as proposals by the delivery-pack review.
- Next: Ta and Nakhun answer D12 at the G0 meeting; A11 is evidence for W2-08.
- Author: operator=ta session=planning-session model=claude-fable-5-1
- Evidence: docs/product/decisions.md, docs/acceptance.md, BUILD_PLAN.md

## 2026-09-21 (time not recorded) — G0 closed
- What: D01 confirmed by Nakhun to Ta; Ta recorded D02, D03 (W0-W3, synthetic only), D05, D06, D11, D12 with the brief defaults. Register split into recorded and open tables; all documents propagated.
- Why: Ta's instruction after speaking with Nakhun: accept the proposed defaults and finalize the build documents.
- Next: Tech lead claims lane-lead-integration and opens W0-01 (stack ADR, D04).
- Author: operator=ta session=planning-session model=claude-opus-5
- Evidence: docs/product/decisions.md, changes/2026-09-21-g0-close/

## 2026-09-21 (time not recorded) — GitHub issues opened for W0-W3
- What: 4 epics (#51, #52, #53, #54) and 45 ticket issues created from the delivery pack, with labels, milestones and dependency links. W0 tickets are status:ready.
- Why: Ta asked for the tracker of record (D03) to be populated so the team can start.
- Next: Tech lead claims lane-lead-integration and takes #6 (W0-01 stack ADR).
- Author: operator=ta session=planning-session model=claude-opus-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/issues

## 2026-09-26 10:30 — W3 deferred rulings recorded
- What: Ta's rulings on the W3 hardening review section 5 items 2, 3, 5-12 and the walkthrough's status-name question, as one register row; W0-07 3.4 amended to the refusing behaviour for QC after a send-back; follow-up tickets #163-#169 opened under package W3.
- Why: Ta accepted the recommendations presented after W3 acceptance, so the fix track can run as tickets.
- Next: the tickets through the reviewed flow, #163 (display names) first.
- Author: operator=ta session=claude-code-w3-deferred-rulings model=claude-opus-5-5
- Evidence: PR on `codex/w3-deferred-rulings`

## 2026-09-26 02:19 — CLAIM lane-decisions-and-docs
- Author: operator=ta session=w4-gate-briefs model=claude-opus-5-5
- Takes over from: session=none (reason: new)

## 2026-09-26 02:40 — W4 gate material drafted (D08, D09 briefs; draft W4 tickets)
- What: draft decision briefs for D08 (W4 part) and D09, with D07/D10 notes, related questions for Ta and a draft W4 gate entry; a draft W4 ticket breakdown with a W4a/W4b option for Ta. Nothing decided; W4 not authorized.
- Why: Ta's instruction of 2026-09-26, after accepting W3, to prepare the next package's gate material.
- Next: Ta names the AI/COE lead and IT/Security owner; the owners review the briefs; Ta records D08, D09 and the W4 gate entry, or asks for changes.
- Author: operator=ta session=w4-gate-briefs model=claude-opus-5-5
- Evidence: https://github.com/tkhongsap-io/rai-workflow-platform-poc/pull/171

## 2026-09-26 19:00 — W4a gate entry and kickoff rulings recorded
- What: register rows "W4a gate entry", "D05 refinement (upload slot 5 and 9)", "W4a kickoff rulings"; BUILD_PLAN W4a status section; authorization lines in AGENTS and team-and-roles.
- Why: Ta chose W4a first and ruled the slot-5/9 upload owner, the substitute revisit and the provisional rule set in the session of 2026-09-26.
- Next: W4-00a plan review and merge; then W4a issues.
- Author: operator=ta session=claude-code-w4a-gate model=claude-opus-5-5
- Evidence: changes/2026-09-26-w4-00a-plan/
