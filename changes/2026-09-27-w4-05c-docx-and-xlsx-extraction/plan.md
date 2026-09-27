# Plan

1. Board CLAIM (Lane A). Change frame (this folder).
2. RED (tests first, run and watched failing), under `rai-web/server/src/qc/extraction/`:
   - `worker/ooxml.test-helper.ts`: a stored/deflate ZIP writer with per-entry overrides and minimal DOCX/XLSX packages (test-only; excluded from the module graph by its suffix).
   - `worker/zip.test.ts`: stored and deflate parts; each inconsistency (trailing bytes, ZIP64, count mismatch, bad local header, overlap, duplicate name, unsafe name, encrypted, other method, CRC and size mismatch, truncated data); declared and actual part and total over the caps (`limit_bytes`); macro and nested entries.
   - `worker/xml.test.ts`: events, namespaces, entities, DOCTYPE and ENTITY refused, bad references, unbalanced markup, CDATA, comments, processing instructions, invalid UTF-8, BOM.
   - `worker/docx.test.ts` and `worker/xlsx.test.ts`: segments and locators, blank paragraphs and cells, shared and inline strings, rels resolution, prefixed and strict namespaces, bad references, unreadable cases, output caps.
   - `worker/hostile.test.ts`: the W0-08 hostile set under both media types.
   - `worker/extract.test.ts`: the registry now holds DOCX and XLSX (the W4-05b "registry is empty" expectation changes with the plan).
   - `protocol.test.ts`: the ordinal locators accepted and bounded.
   - `client.test.ts`: the real forked worker extracts DOCX and XLSX, refuses a DOCTYPE and a bomb; `selfTest()` extracts the embedded DOCX; the embedded bytes equal the helper's rebuild.
3. GREEN: `worker/{zip,xml,docx,xlsx}.ts`, the registry, `protocol.ts` wire variants, `port.ts` locator, `selftest-docx.ts`, `client.ts` `selfTest`.
4. Cross-check against the W4-09a evaluation renderings (a unit test under `fixtures/src/evaluation/` may import the server worker as the fixtures tests already do; otherwise a scratch run recorded in the review).
5. Full gate, one suite at a time, logs under `/tmp/rai-w4-05c-docx-and-xlsx-extraction-logs/`.
6. review.md, DEVLOG, CHANGELOG; commit, push, verify the remote head, open the PR ("Refs #220").
