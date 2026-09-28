# Plan: identity-mapping configuration contract (W6-11, #255)

1. Board CLAIM on `docs/board/lane-a-workflow-server.md`; this frame.
2. Red: `validate.test.ts` publish cases for a synthetic and invalid mapping, `identity-mapping.test.ts`, `json-kinds.test.ts`, the browser spec; watch them fail (log `unit-red.log`, `browser-red.log`).
3. Green: move the schema to `shared/src/schemas/identity-mapping.ts`, re-export from `identity/group-mapping.ts`, register in `cases.ts`. Update the expectations that asserted the absent schema (validate, seed, routes, w1-00, w6-02, w6-04 tests).
4. UI: `json-kinds.ts`, `json-editor.tsx`, `DraftEditor` takes a JSON form for JSON kinds; `configuration-kind.tsx` hosts it; locales th/en.
5. Docs: identity adapter 9.2 dated amendment; DEVLOG top entry; CHANGELOG line.
6. Full gate one suite at a time; review.md with exact commands and results; commit, push, PR "Refs #255".
