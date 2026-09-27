# Plan

1. Board CLAIM on `docs/board/lane-lead-integration.md`. Change frame (this folder).
2. RED: link the 0006 row of `adr/README.md` to `0006-qc-engine-and-extraction.md` before the file exists; `node scripts/check-links.mjs` must report the broken link.
3. GREEN: write the ADR from plan section 1 (decisions 5, 7, 8, 12-16, 14b, 27) and sections 3.4, 4, 5, 11 and 12; check-links passes.
4. Dated notes: threat-model rows, upload safety section 10, W0-02 section 4.
5. Full plan section 16 gate, one suite at a time, logs under `/tmp/rai-w4-01-adr-0006-qc-engine-logs/` (documentation-only change, so the suites prove nothing regressed; no test is added, because no behaviour changes).
6. review.md, DEVLOG, CHANGELOG; commit, push, verify the remote head, open the PR ("Refs #200").
