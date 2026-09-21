# Plan: W1-00 amendment — `owningLaneForSlot` and the `qc.finding.*` locale keys

2026-09-22. Contract PR amending W1-00 (issue #16), branch `codex/w1-00-qc-shared-contract`, worktree `/Users/tkhongsap/github/rai-wt/W1-00-qc-shared-contract`. Lane A (`shared/src/`, contract PRs only). Written before code, per AGENTS.md.

## Intent

Two W1-00 gaps that the QC substitute (W1-10, PR #69) depends on:

- W0-07 section 3.3 names `owningLaneForSlot` as a W0-06 export that "W0-02 places in `shared/src/constants.ts`"; W1-00 (#67) shipped `lanesForSlot` and `slotsForLane` only.
- W0-02 section 10 rules 1 and 8: every finding message is a `{ messageKey, params }` pair whose key exists in both catalogues; W0-07 3.5 names the five scripted rule families and 3.6 names `qc.finding.unavailable`. W1-00 shipped no `qc.finding.*` key.

PR #69 (Lane C) carried both. Its review round 1 refused the touch on a Lane A module (team-and-roles working agreement: a change to a shared interface contract is its own PR and merges before any consumer PR; W0-02 section 11 restates it). This amendment lands the additive rows as a contract PR, exactly as #71 did for `mail/dedup.ts`, so #69 can rebase on it with no change to the substitute.

## Scope (files)

- `rai-web/shared/src/constants.ts` — `owningLaneForSlot(slot, mapping): Lane | 'refinement_pending'`, the W0-06 section 7.1 rule verbatim: the one lane of a single-lane slot (1, 2, 3, 4, 6, 7, 8); `'refinement_pending'` for slots 5 and 9 until W0-06 7.3 is recorded. Pure, built on `lanesForSlot`; no design choice.
- `rai-web/shared/src/constants.test.ts` — one added case: the seven single-lane slots map under `LANE_MAPPING_V1`, slots 5 and 9 return `'refinement_pending'`.
- `rai-web/shared/src/locales/th.json`, `en.json` — six keys, Thai first (D12): `qc.finding.acc_band_v1_sheet3`, `qc.finding.acc_classic_ml_metric`, `qc.finding.acc_extraction_not_hallucination`, `qc.finding.acc_metric_cited`, `qc.finding.pack_slot_missing`, `qc.finding.unavailable`. The existing `locales.test.ts` parity check covers both files.
- `changes/2026-09-22-w1-00-qc-shared-contract/plan.md`, `review.md`.

Not touched: anything else. No dependency, script, config or migration change. `shared/src/qc/validate.ts` stays in #69 (W0-02 1.1 places `shared/src/qc/` in the QC-boundary module, ticket W1-10). Decisions D07-D10 untouched; W0-06 7.3 stays open (no lane for slot 5 or 9 is guessed); the frozen source spec untouched.

## Checks to run afterwards

In `rai-web/`: `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run build && npm run check:substitute-absent`. `npm run test:integration` against Postgres on port 54320 (`docker compose -p rai-w1-00-qc`) to show the W1-00 suite still passes; this amendment adds no integration test. `node --test tests/*.test.mjs` at the repository root (frozen-source hash). `git diff --check`.
