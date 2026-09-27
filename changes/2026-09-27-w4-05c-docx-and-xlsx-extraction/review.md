# Review: DOCX and XLSX extraction (W4-05c, #220)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: the W4-05c row of section 15 of the [W4b plan](../../docs/engineering/implementation-plan-w4b.md), sections 4.3 and 4.4, decisions 8, 21 and 23, and the provisional [ADR-0006](../../adr/0006-qc-engine-and-extraction.md) (the plan wins over issue #220). Decisions implemented: register rows "Ta's delegation (2026-09-27)" and the W4b "delegated rulings (provisional)" row. D07-D10 stay open; nothing here depends on them.

## Change

Under `rai-web/server/src/qc/extraction/` unless noted.

- **ZIP** (`worker/zip.ts`, new): `openZip(bytes, { maxPartBytes, maxTotalBytes })`. The central directory is read as `artifacts/sniff.ts` reads it (restated, because the worker may not import server code): EOCD at the exact end, one disk, matching counts, no ZIP64, the directory right before the EOCD, at most 2 000 entries, safe and unique names, no encrypted entry, stored or deflate only, and no macro project, nested archive or executable. Every entry's data lies inside the file and before the directory, and no two entries overlap. A part is read on demand: the local header must name the same part, deflate runs through `inflateRawSync` with `maxOutputLength`, and the output length and CRC-32 must equal the directory's. A declared or actual part over 20 MiB, or a declared or actual total over 100 MiB, is `limit_bytes`; any other inconsistency is `unreadable`.
- **XML** (`worker/xml.ts`, new): `decodeXml` (strict UTF-8, BOM dropped, UTF-16 refused, line ends normalised) and `xmlEvents`, a linear tokenizer yielding namespace-resolved open, close and text events. A DOCTYPE or any other `<!` declaration except comments and CDATA is `unreadable`, as are references other than the five predefined and numeric ones, unbalanced or unterminated markup, a second root, duplicate attributes, and a declared encoding other than UTF-8.
- **DOCX** (`worker/docx.ts`, new): reads `word/document.xml`. Every WordprocessingML `p` takes the next 1-based ordinal in document order (Transitional and Strict namespaces, any prefix). A paragraph's text is its `t` text, with `tab` read as a tab and `br`/`cr` as a line break. `delText` and `instrText` are not read, and `mc:Fallback` is skipped. Each non-blank paragraph yields one segment with locator `{ kind: 'section', index }`.
- **XLSX** (`worker/xlsx.ts`, new): sheet order comes from `xl/workbook.xml` and parts from `xl/_rels/workbook.xml.rels`. Targets are relative to `xl/` or absolute, and a target that escapes the package is `unreadable`. A package without that rels part falls back to `xl/worksheets/sheetN.xml`. Strings come from shared strings (through the sharedStrings relationship when present) and inline strings, with phonetic runs skipped. Cell types `s`, `inlineStr`, `str`, `e`, `d`, `n`/absent and `b` (`TRUE`/`FALSE`) are read from the cached value, and formulas are never evaluated. Each non-blank cell yields one segment with locator `{ kind: 'cell', sheetIndex, cell }`. A cell whose `r` is missing or fails `^[A-Z]{1,3}[1-9]\d{0,6}$` is `unreadable`, and so is a bad shared-string index.
- **Worker plumbing**: `worker/sink.ts` (new) holds what W4-05b had in `extract.ts` for the sink, typed stop, worker limits and locator. `extract.ts` re-exports it unchanged and registers DOCX and XLSX in `FORMAT_EXTRACTORS`. PDF, PNG and JPEG stay unregistered, so they remain `unreadable` until W4-05d.
- **Wire and port**: `protocol.ts` `WireLocatorSchema` also accepts the two text-free ordinal shapes, closed to extra keys: `section.index` is an integer of at least 1, `cell.sheetIndex` is an integer of at least 1, and `cell.cell` must match `CELL_REFERENCE_PATTERN`. `port.ts` `Locator` is `EvidenceLocator | OrdinalLocator`.
- **Self-test**: `selftest-docx.ts` (new) embeds a 515-byte stored synthetic DOCX. `client.ts` `selfTest()` is true only when that DOCX extracts to its one expected paragraph at `{ kind: 'section', index: 1 }`.
- **Tests** (45 new, 1 changed): `worker/zip.test.ts` (7), `worker/xml.test.ts` (10), `worker/docx.test.ts` (10), `worker/xlsx.test.ts` (8), `worker/hostile.test.ts` (4), `protocol.test.ts` (+1), `client.test.ts` (+4, all through the real fork), and `rai-web/fixtures/src/evaluation/extraction.test.ts` (1, new). `worker/ooxml.test-helper.ts` is a test-only ZIP writer with per-entry overrides; its suffix keeps it out of the module graph.

## Done-when evidence

| Row item | Evidence |
| --- | --- |
| Synthetic DOCX yields ordinal segments | `docx.test.ts`: segments `{ kind: 'section', index }` for paragraphs 1..n; blank paragraphs keep their ordinal; tables and text boxes are numbered in document order; `client.test.ts` shows the same through the forked worker |
| Synthetic XLSX yields cell segments | `xlsx.test.ts`: `{ kind: 'cell', sheetIndex, cell }` for shared, inline, numeric, boolean, error, date and formula-cached cells; workbook order through rels; `client.test.ts` through the fork |
| DOCTYPE → clean `ok:false` | `xml.test.ts`, `docx.test.ts`, `xlsx.test.ts` (in a sheet), `client.test.ts` through the fork (`unreadable`) |
| Zip bomb → clean `ok:false` | declared bomb (`limit_bytes` before any inflate) and lying bomb (64 MiB of output capped by `maxOutputLength`, `limit_bytes`) in `zip.test.ts`, `hostile.test.ts` and `client.test.ts` through the fork |
| Inconsistent ZIP → clean `ok:false` | `zip.test.ts`: 18 container and 5 part inconsistencies, each `unreadable`; trailing bytes through the fork |
| Hostile set passes | `hostile.test.ts`: every W0-08 row under all five media types is a clean reply, and every refused row is `ok:false`. The package rows are rebuilt over a text-bearing DOCX, so each refusal comes from the check itself, not from an empty body |
| Evaluation set readable at the labelled locators | `fixtures/src/evaluation/extraction.test.ts`: every W4-09a DOCX and XLSX rendering extracts, every claim locator the renderer records names an extracted segment, and the `docx_doctype` rendering is `unreadable` |

## Performance (scratch, source layout through `tsx`, not committed)

A 7.7 M-character `document.xml` with 15 000 text paragraphs among 900 000 empty ones extracted in 331 ms. An XLSX with 48 000 cells extracted in 361 ms. The built layout (`server/dist`, plain `node` under the permission model) passes `selfTest()` in 25 ms. All three are far inside `QC_EXTRACT_TIMEOUT_MS=4000`. The W4-05b latency test still passes in the unit suite (source 42-56 ms, precompiled 23-26 ms for a two-slot attempt).

## Deviations

These are choices made under Ta's delegation of 2026-09-27 where the plan is silent or does not fit. Each one keeps the plan's contracts.

- **Ordinal locators before W4-16.** W4-16 (locators carry no text) has not started, so the shared `EvidenceLocator` still has only `section.heading` and `cell.sheet`. The plan's section 4.3 locators (`section.index`, `cell.sheetIndex`) are the W4-16 shape, so the parsers emit that shape now. The host's strict wire schema gains the two ordinal variants, and `port.ts` widens `Locator` with an `OrdinalLocator` union until W4-16 adds them to the shared type, after which the union adds nothing. The text variants stay on the wire for now: W4-16 retires them from the shared contract and the wire follows then. No parser emits them. `protocol.ts` and `port.ts` sit outside the row's path list but inside this ticket's directory. No shared, UI or runner file changes.
- **`worker/sink.ts` split out of `extract.ts`.** The format files need the sink and typed stop, and `extract.ts` imports the format files for the registry. Keeping both in `extract.ts` would create an import cycle, which breaks at module evaluation when a format file is loaded first. The content moved unchanged, and `extract.ts` re-exports every name, so `protocol.ts` and the W4-05b tests import exactly as before.
- **The extractor refuses what the upload refuses.** A macro project, a nested archive or executable, an encrypted entry, ZIP64 and trailing bytes are `unreadable` in the worker too. The upload already refuses them, so this is defence in depth. It also means the hostile set is refused by rule, not only because an entry has no text.
- **Declared sizes are checked before any inflate.** A declared part over 20 MiB, or a declared total over 100 MiB, is `limit_bytes` at open. The actual inflated bytes are also capped per part (`maxOutputLength`) and in total, and they must equal the declared size.
- **Missing cell reference.** A `c` element without `r` is `unreadable`, not positioned by inference. Excel, LibreOffice and the W4-09a generator always write `r`, and inferring positions would add code for no current case.
- **Paragraph ordinals count every paragraph.** Blank paragraphs take an ordinal but yield no segment. The plan says "one per `w:p`" and "1-based paragraph ordinal". Counting every paragraph keeps the locator a stable position in the document, and it matches the W4-09a renderer, which numbers every paragraph it writes.
- **XML scope.** UTF-16 parts are `unreadable`: Office writes UTF-8, and a second decoder is more attack surface. XML names containing combining marks or joiners are `unreadable`, because no OOXML name uses one and the lint rule `no-misleading-character-class` refuses them in a character class.
- **Self-test DOCX as a checked constant.** The embedded bytes are a base64 constant in `selftest-docx.ts`, not built at start-up, so no ZIP writer ships in product code. `client.test.ts` rebuilds them from the test helper and requires a byte-for-byte match.
- **Evaluation cross-check lives in `fixtures/`.** The server may not import `@rai/fixtures` (W0-02 section 1.1), but fixtures may import server modules, as `render.test.ts` already does with `sniff`. The new `fixtures/src/evaluation/extraction.test.ts` ends in `.test.ts`, which the set hash excludes, so `qc-eval-synthetic@1` is unchanged (`generate.test.ts` still matches the manifest).
- **Changed test expectation (plan-driven).** `worker/extract.test.ts` "with no format registered, every media type is unreadable" asserted `FORMAT_EXTRACTORS.size === 0`, which was true only until W4-05c by that test's own message. It now asserts that the registry holds exactly DOCX and XLSX, and that every media type is still `unreadable` for bytes that are not a package. The W4-05b client test "answers every media type as unreadable until W4-05c and W4-05d" is unchanged and still passes, because its bytes are not a package. No other existing test changed.
- No config key, runner, orchestrator change, migration or UI (W4-13b, W4-06a). No spec amendment is assigned to W4-05c.

## Commands and results

Worktree `/tmp/rai-w4-05c-docx-and-xlsx-extraction`, Postgres project `rai-qc-content` on 55382. `rai-web/.env` comes from `.env.example` with the ports rewritten (8811/8812/8813/5192), `OBS_MIGRATION_ADMIN_URL` appended and `RAI_PG_TOOLS=docker-compose:rai-qc-content`. Logs are in `/tmp/rai-w4-05c-docx-and-xlsx-extraction-logs/`. Base: `origin/main` 8c4a124.

| Command (from `rai-web/` after `set -a; . ./.env; set +a`, unless noted) | Result |
| --- | --- |
| RED: `NODE_ENV=test node --import tsx --conditions=rai-source --test 'server/src/qc/extraction/**/*.test.ts' fixtures/src/evaluation/extraction.test.ts`, before the code | 62 tests, 50 pass, 12 fail for the right reason: `sink.js`, `zip.js`, `xml.js`, `docx.js` and `xlsx.js` not found; registry empty; ordinal locators refused as `crash`; `selfTest()` true for an echo worker; the real worker returned `unreadable` for DOCX and XLSX; the evaluation renderings did not extract |
| same, after the code | 93/93 |
| `npm ci` | exit 0 |
| `npm run lint` | exit 0 (eslint, prettier check, check-css) |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | 901/901, 0 skipped |
| `npm run migrate` then `npm run test:integration` | 394/394, 0 skipped |
| `npm run build && npm run check:substitute-absent` | exit 0; 823 files scanned, 0 with the marker |
| built layout: scratch script importing `server/dist/qc/extraction/client.js` | `selfTest()` true in 25 ms; the embedded DOCX gives one `{ kind: 'section', index: 1 }` segment |
| `npm run test:browser:server` | 205 passed |
| `npm run test:browser:substitute` | 48 passed |
| `node scripts/check-links.mjs` (root) | 411 Markdown files, 1172 relative links, 0 broken |
| `git diff --check` (root) | clean |
| Rebased onto `origin/main` 5cc0f47 (W7-05; conflicts only in CHANGELOG, DEVLOG and the lane-a board, resolved by keeping both entries): `npm ci` | exit 0 |
| rebased: `npm run lint` | exit 0 |
| rebased: `npm run typecheck` | exit 0 |
| rebased: `npm run test:unit` | 917/917, 0 skipped |
| rebased: `npm run migrate` then `npm run test:integration` | 395/395, 0 skipped |
| rebased: `npm run build && npm run check:substitute-absent` | exit 0; 823 files scanned, 0 with the marker |
| rebased: built-layout scratch script | `selfTest()` true in 25 ms |
| rebased: `npm run test:browser:server` | 205 passed |
| rebased: `npm run test:browser:substitute` | 48 passed |
| rebased: `node scripts/check-links.mjs` (root) | 416 Markdown files, 1184 relative links, 0 broken |
| rebased: `git diff --check origin/main` (root) | clean |

## Review verdicts

| Round | Head | Reviewer | Verdict | Notes |
| --- | --- | --- | --- | --- |
| - | - | - | pending | Two independent reviewer verdicts on the PR head, and green CI on that head, are recorded here before merge (D03 ticket flow). |
