# Plan

1. Board CLAIM on `lane-a-workflow-server.md`. Change frame (this folder).
2. RED:
   - `server/src/configuration/{qc-rules,seed}.test.ts`: the params schema required and checked, cross-field problems refused on publish; seeded entry and params in both templates.
   - `server/src/qc/content/rules/pack-contradiction.test.ts`: conflicting slot 2 and slot 5 facts give one pack finding per contradicting fact (`claimKey` = fact ID) with two cited artifacts; two contradicting facts give two findings; agreeing, absent, `na` and single-artifact facts give none; XLSX and DOCX, Thai; facts restricted to their slots; unreadable slot 5 makes the part unavailable; trigger refusal; invalid cross-field params refused before any read.
   - `server/src/qc/rule-registry.test.ts`: content entries equal `CONTENT_RULES`.
   - `server/src/qc/select.test.ts`: submit selection includes `PACK-CONTRADICTION` for every model type.
   - `fixtures/src/evaluation/content-rules.test.ts`: submit runs compared; `PACK-CONTRADICTION` reproduced.
3. GREEN: `shared/src/schemas/cases.ts`, `shared/src/qc/rule-registry.ts`, `server/src/configuration/seed.ts`, `server/src/qc/content/rules/{pack-contradiction,rule,index}.ts`, `server/src/qc/content/runner.ts` (cross-field params check), locales; any test asserting the seeded submit selection updated.
4. Documents: W0-07 3.5 dated note.
5. Full gate, one suite at a time, logs under `/tmp/rai-w4-06d-pack-contradiction-seed-entry-logs/`.
6. review.md, DEVLOG, CHANGELOG; commit, push, verify the remote head, open the PR ("Refs #244").
