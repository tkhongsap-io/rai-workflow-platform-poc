# Plan

1. Board CLAIM (lane B). Change frame (this folder).
2. RED:
   - `tests/integration/w4-12-qc-runs.test.ts` (new, fixture app with the scripted substitute runner): qc-runs shapes, order, label, `null` label; evidence on both finding shapes without hashes; scope against the findings read; draft; no write.
   - `tests/integration/w4a-int-deterministic-server.test.ts`: the qc-runs read over HTTP on the real server (`deterministic` runner, server version, `w4a.1`, rules evaluated, finding count; the upload run on the draft).
   - `web/src/screens/case/view-model.test.ts`: rule-label key, evidence-location summary, run outcome classification, the lane result for 0 rules evaluated.
   - `web/src/api/client.test.ts`: `listQcRuns` path.
   - `tests/browser/w4-12-qc-log.spec.ts` (new, real server): QC log and the unavailable block before the controls, finding row details, th and en, three widths, axe, keyboard.
3. GREEN:
   - `shared/src/schemas/review.ts`: `EvidenceLocatorSchema`, `FindingEvidenceSchema`, `evidence` on both finding shapes, `QcRunSummarySchema`, `VersionQcRunsResponseSchema`.
   - `server/src/qc/repository.ts`: `storedFindingSummary` maps stored evidence to the read shape.
   - `server/src/findings/repository.ts`: `listQcRunsForVersion` (one query: run rows, `qc_rules` label join, finding count).
   - `server/src/findings/routes.ts`: the GET route, same guard as the findings read.
   - `web/src/api/client.ts`: `listQcRuns`.
   - `web/src/screens/case/view-model.ts`: pure helpers.
   - `web/src/screens/case/qc-log.tsx` (new), `finding-list.tsx` (row details, unavailable-runs block), `reviewer-workspace.tsx` (load runs, show every unavailable run, 0-rules lane result), `case-screen.tsx` (QC log on the version view, refreshed after a lane run), `case.css`.
   - `shared/src/locales/th.json`, `en.json`: new keys.
4. Docs: W0-02 section 7.7 dated amendment.
5. Full plan section 8 gate, one suite at a time, logs under `/tmp/rai-w4-12-qc-log-ui-logs/`.
6. review.md, DEVLOG, CHANGELOG; commit, push, verify remote head, open the PR ("Refs #189").
