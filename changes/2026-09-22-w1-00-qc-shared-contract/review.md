# Review: W1-00 amendment — `owningLaneForSlot` and the `qc.finding.*` locale keys

2026-09-22. Contract PR amending W1-00 (issue #16), branch `codex/w1-00-qc-shared-contract`, worktree `/Users/tkhongsap/github/rai-wt/W1-00-qc-shared-contract`. Lane A. Plan recorded before code in [plan.md](plan.md). Human review remains authoritative; nothing here is merged or published.

## What landed

- `rai-web/shared/src/constants.ts` — `owningLaneForSlot(slot, mapping): Lane | 'refinement_pending'`, the [W0-06 section 7.1](../../docs/engineering/workflow-transition-and-error-contract.md#71-recorded-rule-single-lane-slots) rule as [W0-07 section 3.3](../../docs/engineering/qc-boundary-and-mail-sink.md#33-interface-typescript-notation) names it: `lanesForSlot(slot, mapping)` has exactly one lane for slots 1, 2, 3, 4, 6, 7 and 8 and that lane is returned; slots 5 and 9 return `'refinement_pending'` until W0-06 7.3 is recorded. No finding is ever stored with that value (W0-07 3.4 step 5 rejects it as `owning_lane_rule_pending`). Pure; no new import.
- `rai-web/shared/src/constants.test.ts` — one `node:test` case under `LANE_MAPPING_V1`: 1 → `ai_coe`; 2, 3, 4 → `dpo`; 6, 7, 8 → `it_security`; 5 and 9 → `'refinement_pending'`.
- `rai-web/shared/src/locales/th.json`, `en.json` — six keys, Thai first (D12), placeholders in `{name}` form for `t()`: the five scripted rule families of W0-07 3.5 (`qc.finding.acc_band_v1_sheet3`, `qc.finding.acc_classic_ml_metric`, `qc.finding.acc_extraction_not_hallucination`, `qc.finding.acc_metric_cited`, `qc.finding.pack_slot_missing`) and the orchestrator's `qc.finding.unavailable` of W0-07 3.6. Sorted into the existing key order; the existing `locales.test.ts` parity and namespace checks pass.

Why a separate PR: PR #69 (W1-10, Lane C) carried these rows. Its review round 1 refused the touch on a Lane A module per the [working agreement](../../docs/delivery/team-and-roles.md) (a shared-contract change is its own PR, merged before any consumer PR; W0-02 section 11) and pointed at W1-00 as their owner (W0-07 3.3; W0-02 section 10 rules 1 and 8). Same shape as #71 for `mail/dedup.ts`. #69 is rebased on this branch and drops the four files; the substitute code and its tests are unchanged and keep asserting on these rows from `fixtures/`.

Not touched: `shared/src/qc/validate.ts` (stays in #69: W0-02 1.1 puts `shared/src/qc/` in the QC-boundary module, ticket W1-10), dependencies, scripts, `.env.example`, `config.ts`, migrations, the frozen source spec, `docs/product/decisions.md` (D07-D10 open; W0-06 7.3 not guessed), `docs/board`, DEVLOG, CHANGELOG.

## Commands run and results

Shell: `export PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH` (Node 24.21.0, npm 11). Postgres: `POSTGRES_PORT=54320 docker compose -p rai-w1-00-qc up -d --wait` from the worktree root (project name distinct from #71's so both can run), `DATABASE_URL` / `DATABASE_MIGRATE_URL` on port 54320, `down -v` afterwards.

| Command (from `rai-web/` unless noted) | Result |
|---|---|
| `npm ci` | installed from the committed lock file; no dependency change |
| `npm run typecheck` | `tsc -b` clean |
| `npm run lint` | eslint clean; `All matched files use Prettier code style!`; `check-css: no outline removal outside :focus-visible` |
| `npm run test:unit` | tests 59, pass 59, fail 0 (58 from W1-00 + 1 in `constants.test.ts`) |
| `npm run migrate` (port 54320) | `migrate: applied 1 migration(s), 0 already applied` |
| `npm run test:integration` (port 54320) | tests 14, pass 14, fail 0 (the W1-00 suite; this amendment adds no integration test) |
| `npm run build && npm run check:substitute-absent` | `check-substitute-absent: scanned 138 files, 0 with the marker` |
| `node --test tests/*.test.mjs` (repository root) | tests 22, pass 22, fail 0 (frozen-source hash unchanged) |
| `git diff --check` | clean |
| `docker compose -p rai-w1-00-qc down -v` | removed |

## Notes for the lead

- Both rows are transcriptions: the function is the W0-06 7.1 sentence, the keys are the W0-07 3.5/3.6 names. The Thai and English strings are the ones #69 carried, unchanged.
- The PR that records W0-06 7.3 amends `owningLaneForSlot` (slot 5 and 9 branch) in a contract PR of its own; nothing here anticipates it.
- Merge order: this PR, then #69 (W1-10), whose base is this branch until it merges.
