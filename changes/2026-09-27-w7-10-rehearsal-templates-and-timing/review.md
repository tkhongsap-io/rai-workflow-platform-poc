# Review: rehearsal templates and timing capture (W7-10, #210)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W7 plan](../../docs/engineering/implementation-plan-w7.md) section 9 row W7-10, sections 1.2, 2 (`REHEARSAL_OUT_DIR`), 11 and 13 (the plan wins over issue #210). Decisions implemented: register rows "Ta's delegation (2026-09-27)" and "W7 delegated rulings (provisional)" (W7-D13, W7-D15, W7-D16, W7-D18); W7-D19 (the real rehearsal) stays **pending D08 and the operator** and is not claimed. Synthetic data only; no external network call; nothing deployed; no product code and no migration.

## Change

- **`docs/operations/rehearsal/`**: `rehearsal-plan-template.md` (run identity, scope over the section 11 `REH-` cases, roles, preconditions, steps with the timer's step IDs, W7-D16 stop rules, sign-off), `timing-sheet-template.md` (table columns identical to `timings.csv`; timings without a target, W7-D15), `deficiency-log-template.md` (the W7-D16 blocking rule; kinds `defect`, `guide`, `disagreed-finding`, `workaround`, `other` from the BUILD_PLAN W7 capture list; unaided-completion table; W7-15.n issue column), `acceptance-report-template.md` (W7-D15 synthetic pass criteria as a checklist; the pending items; proposed real PoC acceptance criteria P1-P9, labelled "proposal, not accepted, not in force", for Ta and Nakhun at the D08-gated rehearsal; operator and owner decision rows set to pending) and a `README.md` index. Each links the W7 plan, the register, BUILD_PLAN or the acceptance contract and its sibling templates; each states that agent runs are synthetic only and that a real rehearsal's contents never enter Git.
- **`rai-web/tests/rehearsal/timing.ts`** (test support; the server never imports it): `RAI_WEB_ROOT`, `TIMING_CSV_COLUMNS`, `resolveRehearsalOutDir(env, { cwd?, raiWebRoot? })` (unset or blank → `<rai-web>/.local/rehearsal`; relative → against the working directory; refused with `RehearsalConfigError('invalid:REHEARSAL_OUT_DIR')` unless strictly inside `<rai-web>/.local/`), `createStepTimer(runId, { env?, cwd?, raiWebRoot?, now? })` → `{ runId, dir, start, end, time, entries }`. Run IDs `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` (`invalid:runId`). The run directory is checked through real paths before and after it is created, so a symlink out of `.local/` is refused and nothing is created through it. Each `end` rewrites `timings.json` and `timings.csv` (temporary file plus rename, 0600; directory 0700). CSV: RFC 4180 quoting, CRLF, text cells starting with `=`, `+`, `-` or `@` prefixed with `'` (JSON keeps the original). Durations are whole milliseconds, never negative. `time()` records `failed` with the error message and rethrows. Misuse (empty step ID, a step started twice, ended without a start) throws `TimingError`.
- **`rai-web/tests/rehearsal/timing.test.ts`**: 13 unit tests (spec item 3), including the timing-sheet template's column check.
- **`rai-web/tests/tsconfig.json`** includes `rehearsal/**/*.ts` (typecheck and type-aware lint); **`rai-web/package.json`** `test:unit` gains `'tests/rehearsal/*.test.ts'`; **TESTING** `test:unit` comment names `tests/rehearsal`.

## Deviations

- **Kit README.** The plan's file list names the four templates; a `README.md` index was added so the folder explains the kit, how the templates relate and where timings come from.
- **Where the timer's tests run and typecheck.** The plan names only `tests/rehearsal/timing.ts` and says "unit-tested". The test sits beside it (`tests/rehearsal/timing.test.ts`), which needed the `test:unit` glob and the `tests/tsconfig.json` include (otherwise ESLint's project service and `tsc -b` would not see the files). W7-11 and W7-12 add their files to the same folder.
- **`createStepTimer` options.** The plan writes `createStepTimer(runId)`; that call works as written (defaults: `process.env`, `process.cwd()`, the real `rai-web/`, the system clock). The optional second argument injects them so tests never write under the real `.local/` and timings are exact.
- **Output under `REHEARSAL_OUT_DIR/<runId>/`.** The row says "under `REHEARSAL_OUT_DIR`"; the per-run folder matches section 11's `REHEARSAL_OUT_DIR/<runId>/loaded.json`, so the loader and the timer of one run share a folder.
- **Stricter than `BACKUP_DIR`.** Section 2 says the timer refuses "a path outside `.local/`": it is refused outside the repository too (unlike `BACKUP_DIR`), `.local` itself is refused (strictly inside), and the check follows symlinks (W7-01 recorded its `BACKUP_DIR` rule as lexical). A safe run-ID pattern was added so a run ID cannot climb out of the folder.
- **Write after every step, atomically, with a formula guard.** Not in the plan: rewriting both files at each `end` keeps a crashed run's timings; the rename means a reader never sees half a file; the CSV formula guard keeps a note from running as a spreadsheet formula when the sheet is opened.
- **Proposed real acceptance criteria.** W7-D15 says real PoC acceptance criteria are proposed in the acceptance-report template. They are written as P1-P9 with the acceptance IDs they touch, marked as a proposal that neither Ta nor Nakhun has agreed; no time targets (W7-D15 B rejected).
- **Record dates.** The change folder carries the plan's date (2026-09-27) as assigned; the board CLAIM and DEVLOG entry carry the working date 2026-09-28; the CHANGELOG line sits under "## 2026-09-27" as assigned.

## Commands and results

Worktree `/tmp/rai-w7-10-rehearsal-templates-and-timing`, Postgres project `rai-ops` on 55385, `rai-web/.env` from `.env.example` with 54320 → 55385, `PORT=8841`, `PUBLIC_BASE_URL=http://127.0.0.1:8841`, `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8842`, `SUBSTITUTE_PORT=8843`, `SUBSTITUTE_WEB_PORT=5195`, `OBS_MIGRATION_ADMIN_URL` for 55385, `RAI_PG_TOOLS=docker-compose:rai-ops`. One suite at a time after `set -a; . ./.env; set +a`; logs under `/tmp/rai-w7-10-rehearsal-templates-and-timing-logs/`.

| Command (from `rai-web/` unless noted) | Result |
|---|---|
| RED: `NODE_ENV=test RAI_IDENTITY_MODE=fixture node --import tsx --conditions=rai-source --test tests/rehearsal/timing.test.ts` | fails: `ERR_MODULE_NOT_FOUND` for `tests/rehearsal/timing.js` |
| GREEN: same command after `timing.ts` | 12/13; the template-columns test fails (`ENOENT` timing-sheet template) |
| same command after the templates | 13/13 |
| Mutation: the two real-path checks removed | the symlink test fails; restored |
| Mutation: the formula guard regex emptied to `/^$/` | the CSV and JSON/CSV tests fail; restored |
| `npm ci` | exit 0 |
| `npm run lint` | exit 0; first run: Prettier flagged the two new files, formatted with `prettier --write` on those files only |
| `npm run typecheck` | exit 0 (`tests/dist/rehearsal/timing*.js` emitted, so the files are in the project) |
| `npm run test:unit` | exit 0, 885/885 (872 before + 13) |
| `npm run test:integration` | exit 0, 395/395, 0 skipped |
| `npm run build && npm run check:substitute-absent` | exit 0; `scanned 775 files, 0 with the marker` |
| `npm run test:browser:server` | exit 0, 205 passed (8.2 min) |
| `npm run test:browser:substitute` | exit 0, 48 passed (30.0 s) |
| `npm run test:rehearsal` | not run: the script starts at W7-12 (plan section 10) |
| `node scripts/check-links.mjs` (repo root) | exit 0; 421 Markdown files, 1209 relative links, 0 broken |
| `git diff --check` (repo root) | exit 0 |

## Review verdicts

Pending: two independent reviewer verdicts on the exact PR head and green CI on that head (D03 ticket flow). Ta reviews the W7 exit record.
