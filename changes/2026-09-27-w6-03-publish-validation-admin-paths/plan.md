# Plan: W6-03 publish validation and implemented-rule registry (#223)

Recorded before code.

1. Board CLAIM on `docs/board/lane-a-workflow-server.md`; this change frame.
2. RED: `server/src/qc/rule-registry.test.ts` (metadata entries equal `METADATA_RULES` keys and triggers; content entries; seed catalogue rules all registered; `ACC-BAND-V1-SHEET3` isolated to `v1.0 Sheet3`) and `server/src/configuration/validate.test.ts` (seed bodies publishable; schema first; unknown rule; engine mismatch; trigger superset; template isolation for v2.0; coverage in both orders including nothing in force; non-synthetic recipient under both sink modes; other kinds schema only; problem strings carry a pointer and a code). Run `npm run test:unit` and watch them fail (modules missing).
3. RED: a new `tests/integration/w6-03-publish-validation.test.ts`: `publishDraft` refuses an unimplemented rule, a v2.0 band rule and an uncovered template (draft kept, nothing written), accepts the order `qc_rules` then `checklist_templates`; `restoreRevision` refuses a revision whose body fails today's cross-kind checks; an Admin publish of a real recipient is refused while `publishRevision` still accepts it (the w3-03b path).
4. GREEN: `shared/src/qc/rule-registry.ts`; `server/src/configuration/validate.ts` (moved `validateConfigurationBody`/`ConfigurationBodyInvalid`, `publishProblems`, `PUBLISH_PROBLEM_CODES`); `store.ts` calls it in `publishDraft` and `restoreRevision`, re-exports the moved names.
5. Full gate (lint, typecheck, unit, integration, build + substitute-absent, both browser suites, link check, `git diff --check`), fixing every failure.
6. Records: review.md with exact commands and results, DEVLOG top entry, CHANGELOG line under 2026-09-27. No spec amendment is assigned to W6-03 by plan section 17.
7. Commit, push, verify remote head, open PR "Refs #223".
