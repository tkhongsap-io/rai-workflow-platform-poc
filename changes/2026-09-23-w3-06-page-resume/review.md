# W3-06 page resume review

Local implementation checkpoint; independent Descartes review pending. Exactly six approved tracked files. No product/runtime/schema/dependency/manifest/CI edits; no DB/browser execution during this correction.

## Verification

- Focused normal-runner performance tests: 27 passed, 0 failed, 0 skipped (22 existing plus five new pure route/guard tests).
- `npm run typecheck`: passed (`tsc -b . tests/performance`).
- `npm run lint`: passed (ESLint, Prettier, CSS check).
- Ignored resume-v2 driver: `node --check` passed; this proves syntax only, not actual routes/startup.
- Diff inspection: overview entry navigation remains `/cases/:caseId`; expected final submitted-version URL is required before loaded-content assertions and reasserted after two frames at the timing endpoint. All-five guard retained and validated before browser launch. No artificial sleep added.

Pure tests prove input/path/guard behavior, not async browser behavior. The authorized post-review untimed diagnostic is still required to prove actual entry redirect, final routes and selectors before separate parent timing GO. The measurement driver will invoke only five-page profiles with new output prefix, not the original full driver.

## Evidence and provenance boundaries

A01 seed remains sealed at 0c99d61a61585dca51b333e95886476830419053, including original manifest/source hash. Parent relayed Confucius numerical audit CLEAN: 2,960 completed measured samples, 440 warmups, 3,170 exact HTTP joins. Failed overview warmup remains separate (seven attempts, one failure, zero measured samples, no percentile). Completed HTTP evidence retains its original source attribution. Original queue-page result is historical; new full five-page batch, if successful, defines page baseline.

New measurement HEAD must be supplied after this commit in ignored input and derived new launch configs; seedHead and measurementHead are distinct. Resume driver compares original product inventory and built asset hashes and retained queue/case/version state. Candidate classification remains until actual merged-main fingerprint comparison.

Independent immutable-SHA/hashes handoff occurs outside this self-referential commit. No claim of independent approval, diagnostic success, final five-page baseline, merged acceptance, or M3. Parent owns whole-PR size exception, root exit documents and media.
