# Plan

1. Board CLAIM on `lane-a-workflow-server.md` and the `MIGRATION-SLOT` claim on `lane-lead-integration.md` (plan section 15.2). Change frame (this folder).
2. RED:
   - `tests/integration/w4-11b-run-extraction-identity.test.ts` (new): migration on a W4a database (ephemeral database migrated to 0009, a row, then all migrations; new columns NULL; CHECKs refuse negatives, a detail on a completed run and a detail outside the pattern); completed and unavailable runs record engine identity and detail; `unspecified` and NULL detail; invalid engine → `engine_identity_invalid`; two runs differing only in extractor / model / prompt told apart from rows and lines; qc-runs read fields; desk-health `unavailableDetail`.
   - `shared/src/qc/validate.test.ts`: `QcEngineIdentitySchema` and `QcRunResultSchema` with `engine`.
   - `shared/src/schemas/observability.test.ts`: `unavailableDetail` required, nullable, bounded.
   - `tests/integration/w4-12-qc-runs.test.ts`: the served shape gains the four fields (null for the substitute runs).
3. GREEN:
   - `db/schema/qc-run.ts`, then `npm run migrate:generate`, renamed to `0012_w4_11b_run_extraction_identity.sql` (0010, then 0011, before W5-03 and W7-03 merged first), header and CHECKs reviewed by hand.
   - `shared/src/qc/types.ts` (`QcEngineIdentity`, `engine?`), `shared/src/qc/validate.ts` (schema), `server/src/qc/engine-identity.ts` (new: columns, stored detail, log fields), `qc/repository.ts` (`InsertRunInput`), `qc/orchestrator.ts` (`checkedResult`, `recordRun`, log fields), `observability/log.ts`, `observability/operator.ts`, `shared/src/schemas/{observability,review}.ts`, `findings/repository.ts`.
   - Typed literals: `web/src/screens/case/view-model.test.ts` `qcRun()`, `web/src/api/client.test.ts`, `tests/browser/support/operator-rehearsal.ts`.
   - Documents: W0-02 section 7, W0-04, data contract, W0-07 section 7, W0-10.
4. Full plan section 16 gate, one suite at a time, logs under `/tmp/rai-w4-11b-run-identity-for-extraction-logs/`.
5. review.md, DEVLOG, CHANGELOG; commit, push, verify remote head, open the PR ("Refs #201").
