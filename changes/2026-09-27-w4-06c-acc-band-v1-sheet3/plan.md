# Plan

1. Board CLAIM on `lane-a-workflow-server.md`. Change frame (this folder).
2. RED:
   - `server/src/qc/content/decimal.test.ts`: `ratioToPercent` exact (no float drift, canonical form, negatives, too-long results refused).
   - `server/src/configuration/{qc-rules,seed}.test.ts`: the params schema required and checked; seeded params on `v1.0 Sheet3`, absent from `v2.0`.
   - `server/src/qc/content/rules/acc-band-v1-sheet3.test.ts`: below, equal and above for each tier (equal fails); percent and ratio inputs (exact at the band); missing and unknown tier message; measure and params; Thai words, PDF, XLSX; one finding per claim; `v2.0` never evaluates it (selection and rule); DPO and IT/Security attempts read nothing; trigger refusal.
   - `server/src/qc/content/runner.test.ts`: the seeded `llm` approve-attempt selection completes.
   - `fixtures/src/evaluation/content-rules.test.ts`: four implemented rules against the dev-split labels, band findings exercised.
3. GREEN: `shared/src/schemas/cases.ts`, `server/src/configuration/seed.ts`, `server/src/qc/content/decimal.ts`, `server/src/qc/content/rules/{acc-band-v1-sheet3,index}.ts`, locales; params added to the tests that publish a params-less band entry.
4. Documents: W0-07 3.5 dated note.
5. Full gate, one suite at a time, logs under `/tmp/rai-w4-06c-acc-band-v1-sheet3-logs/`.
6. review.md, DEVLOG, CHANGELOG; commit, push, verify the remote head, open the PR ("Refs #236").
