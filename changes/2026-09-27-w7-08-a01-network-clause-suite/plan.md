# Plan

1. Board CLAIM (lane C stream). Change frame (this folder).
2. RED: `tests/integration/w7-08-network-a01.test.ts` and the new `start.test.ts` case, run before `tests/support/network-sign-in.ts` exists (module not found) and before each assertion was checked against the server.
3. GREEN: `tests/support/network-sign-in.ts`. No product code is expected to change; if an item fails on product behaviour, fix the product under the plan's rules and record it.
4. Docs: acceptance A01 evidence line, W0-03 ID-16, threat model row.
5. Full gate one suite at a time, logs under `/tmp/rai-w7-08-a01-network-clause-suite-logs/`.
6. review.md, DEVLOG, CHANGELOG; commit, push, verify the remote head, open the PR ("Refs #233").
