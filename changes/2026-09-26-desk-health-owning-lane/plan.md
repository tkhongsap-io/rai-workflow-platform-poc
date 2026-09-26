# Plan

1. Board claim on the Lane A stream.
2. RED: the operator-probe test expects `owningLane: 'dpo'` (was `undefined`); watch it fail.
3. GREEN: `readDeskHealth` selects `qc_run.lane` and maps each row through `unavailableOwningLane`; upload runs omitted.
4. Pin the submit case in `w3-int-07-desk-health.spec.ts` (`owningLane: 'ai_coe'`).
5. Update the observability contract comment; DEVLOG and CHANGELOG lines; `review.md` with commands and verdicts.
6. Full suite serially on the worktree's own Postgres (55371); PR; two reviewers; CI; merge through the D03 ticket flow.
