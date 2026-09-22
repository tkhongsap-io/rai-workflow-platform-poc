# Approved file plan — recorded before code

1. rai-web/tests/performance/page-measure.ts: pure entry/final route derivation and five-page validation; wait for final route before loaded-state checks and assert it again at timer end.
2. rai-web/tests/performance/page-measure.test.ts: pure overview redirect, required version/case ID, other-route and exact-five guard regressions.
3. changes/2026-09-23-w3-06-page-resume/intent.md: authority/problem/evidence boundary.
4. changes/2026-09-23-w3-06-page-resume/spec.md: timing/provenance/failure contract.
5. changes/2026-09-23-w3-06-page-resume/plan.md: this prior plan.
6. changes/2026-09-23-w3-06-page-resume/review.md: exact checks and review/runtime gates.

Ignored .local/performance-page-resume-v2/{resume.mjs,input.template.json,README.md,SHA256SUMS} prepares an explicit diagnostic/measure driver over existing exports. Original driver907 and templates stay byte-identical. New private inputs/configs/plan/journals live in .local/performance/w306_20260923_pages_b02. Driver validates original hashes/seed head, actual new clean HEAD, unchanged production fingerprint and retained datasets. It retains Ready version ID in new metadata. Timing invokes only measurePages, never the original full driver. Supersede unexecuted v1 four-page draft.

Verification: focused pure tests, normal typecheck and lint; static syntax check ignored driver, exact scope/source/hashes inspection. Commit immutable six-file checkpoint and hand paths/hashes to Descartes via parent. After independent CLEAN, run authorized untimed route/selector diagnostics and report actual proof. Timing waits separate parent GO. Parent owns root exit docs/media and whole-PR size exception. No product files, runtime/schema/dependencies/manifests/CI edits.
