# Plan

1. Board CLAIM (lane C stream). Change frame (this folder).
2. RED: `rai-web/tests/rehearsal/timing.test.ts` (spec item 3) with `tests/tsconfig.json` and the `test:unit` glob widened; run it and watch it fail (module not found).
3. GREEN: `rai-web/tests/rehearsal/timing.ts`.
4. Templates and folder README under `docs/operations/rehearsal/`; the template-columns test goes green with them. TESTING `test:unit` line.
5. Full plan section 10 gate one suite at a time, logs under `/tmp/rai-w7-10-rehearsal-templates-and-timing-logs/`.
6. review.md, DEVLOG, CHANGELOG; commit, push, verify the remote head, open the PR ("Refs #210").
