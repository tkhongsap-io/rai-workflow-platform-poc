# Review: W2-05 owning-lane rule (#35)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md), written before any change. Decision: Ta accepted the five recommendations of the [#35 brief](../2026-09-23-w3-hardening/issue-35-decision-brief.md) on 2026-09-25 and approved the register row's wording in the same session; the row "D05 refinement (#35)" in [decisions.md](../../docs/product/decisions.md) is the record. Synthetic data only; no other decision touched.

## 1. What changed

- `@rai/shared/constants`: `owningLaneRule(scope, mapping)` and `unavailableOwningLane(run, mapping)` replace `owningLaneForSlot`; `PACK_OWNING_LANE = 'ai_coe'`.
- `@rai/shared/qc/validate`: `checkOwningLane(finding, mapping, runLane)`; violations `owning_lane_slot_informational` and `finding_outside_lane`; `owning_lane_rule_pending` is gone.
- Orchestrator: an `unavailable` run stores the W0-07 3.6 `QC-UNAVAILABLE` finding (`kind = unavailable`, `slot = null`, severity `high`) owned per W0-06 7.2, once per open scope (`findLatestUnavailableFinding`); the lane-QC route and the replay carry it in the run body.
- W1-10 substitute: accepts slot-5 and pack-level `defect` findings with the recorded lane; refuses slot 9; scripts one of each on `fx-case-missing-slot`; locale key `qc.finding.pack_stage_mismatch`.
- No migration: `qc_finding` already allowed `kind = 'unavailable'` and `slot IS NULL`.
- No UI change: the reviewer workspace already lists every stored finding owned by the viewing lane under the outage notice; a browser test now proves it.
- Documents: W0-06 7.1-7.4 and its summary rows; W0-07 line 14, 3.4 steps 5-6, 3.5, 3.6, 3.9; BUILD_PLAN and README status lines; the brief and the walkthrough script note the outcome.

## 2. Commands and results

Filled in by Task 9 (clean run in the worktree `/tmp/rai-w2-05`, Postgres `rai-w2-05` on 55370).

## 3. Reviewer verdicts

Two independent reviewer agents post on the PR; recorded here with the head they reviewed.

## 4. Rulings and exceptions

From the execution ledger; each names its cost if wrong.

## 5. Remaining boundaries

- Upload-triggered QC does not exist in slice 1, so the slot-5 and slot-9 upload sub-case of part 4 is defined with upload QC (W4). `unavailableOwningLane` throws rather than guesses for it.
- With no runner bound (`QC_MODE=none`), every submit and every approve attempt now stores a `QC-UNAVAILABLE` finding its lane must disposition before Ready. That is W0-07 3.6 as written, not a new choice; in fixture mode with the substitute bound it happens only on a simulated outage.
- `PACK-CONTRADICTION` has the rule but no fixture; nothing in slice 1 needs one.
- W2-05 closes #35 and epic #53 on merge. W4-W8 remain unauthorized.
