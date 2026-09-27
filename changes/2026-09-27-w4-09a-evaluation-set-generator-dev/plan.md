# Plan

1. Board CLAIM (Lane C). Change frame (this folder).
2. RED, then GREEN, in this order:
   - `fixtures/src/generate/deflate.test.ts`: fixed-Huffman zlib and raw deflate round-trip through `node:zlib`, deterministic. Then `generate/deflate.ts`.
   - `fixtures/src/evaluation/render.test.ts`: the new PDF and OOXML builders (page count, FlateDecode, image-only and CID pages carry no text operator, broken xref, DOCTYPE, shared strings, deflate entries) and the renderer's claim locators. Then the additive builders in `generate/pdf.ts` and `generate/ooxml.ts`, `evaluation/{types,vocabulary,render}.ts`.
   - `fixtures/src/evaluation/generate.test.ts`: same bytes twice, in memory and on disk; manifest matches; the `slice1-synthetic` manifest still matches (existing `generate.test.ts`). Then `evaluation/{cases,generate}.ts`, `manifest.json`.
   - `fixtures/src/evaluation/labels.test.ts` and `coverage.test.ts`: the section 5 and section 4 checks of the spec. Then `labels/*.json`.
   - `fixtures/src/evaluation/provenance.test.ts`. Then move the denylist into `fixtures/src/provenance-denylist.ts` (outside `data/`, so the `slice1-synthetic` hash is unchanged); `data/provenance.test.ts` re-exports it.
3. `package.json` script `fixtures:eval:generate`; `evaluation/README.md`.
4. Full plan section 16 gate, one suite at a time, logs under `/tmp/rai-w4-09a-evaluation-set-generator-dev-logs/`. Two CLI runs compared byte for byte.
5. review.md, DEVLOG, CHANGELOG; commit, push, verify remote head, open the PR ("Refs #203").
