# Plan

1. Board CLAIM (Lane C). Change frame (this folder).
2. RED:
   - `server/src/config.test.ts`: replace the W4-03 "test-environment value until W4-13" test (its expectation changes by plan) with the section 2 matrix: `deterministic` in every identity mode and `NODE_ENV`; `substitute` accepted for `fixture`/test and `local-google`/development and test; refused for `network`, `production` identity and any mode under `NODE_ENV=production`; unset and unknown per mode.
   - `server/src/start.test.ts`: `deterministic` under `local-google`/development binds and readiness reports `{ kind: 'deterministic', status: 'ok' }`; `substitute` under `network` exits 78 `invalid:QC_MODE` before listening; the absent-fixtures case reports `kind: 'substitute'`.
   - `tests/integration/w1-01-startup-refusals.test.ts`: the real process with `network` identity and `QC_MODE=substitute` exits 78 `invalid:QC_MODE` without listening.
3. GREEN: `config.ts` (`parseQcMode` takes the identity mode), `start.ts` (bind by mode, readiness kind from runner or mode), `tests/support/fixture-app.ts` (kind from the injected runner).
4. Existing tests whose setup the new refusal hits: `server/src/static.test.ts` production case moves to `QC_MODE=deterministic` (it asserts `missing:web/dist`, unchanged).
5. `.env.example`; CI and harness pins checked (already explicit); comments in `runner.ts`, the real-server test, `fixtures/src/substitutes/qc/config.test.ts`.
6. Docs: W0-02 section 5, W0-07 3.9 and section 6, TESTING.
7. Full plan section 8 gate, one suite at a time, logs under `/tmp/rai-w4-13-runner-selection-logs/`.
8. review.md, DEVLOG, CHANGELOG; commit, push, verify remote head, open the PR ("Refs #187").
