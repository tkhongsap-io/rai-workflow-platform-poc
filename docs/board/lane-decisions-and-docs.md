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
