# Review: PDF text layer; images unreadable (W4-05d, #227)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: the W4-05d row of section 15 of the [W4b plan](../../docs/engineering/implementation-plan-w4b.md), sections 4.3 and 4.4, decisions 8, 21 and 23, and the provisional [ADR-0006](../../adr/0006-qc-engine-and-extraction.md) (the plan wins over issue #227). Decisions implemented: register rows "Ta's delegation (2026-09-27)" and the W4b "delegated rulings (provisional)" row. D07-D10 stay open; nothing here depends on them.

## Change

Under `rai-web/server/src/qc/extraction/` unless noted.

- **PDF** (`worker/pdf.ts`, new): `extractPdf`, hand-written on `node:buffer` and `node:zlib`.
  - *Container.* `%PDF-` header, `%%EOF` in the last 1 024 bytes, and the last `startxref` there pointing at a classic `xref` table and `trailer`. Older tables are followed through `/Prev` (newest entry wins; a loop is `unreadable`). A `startxref` that points at a cross-reference stream, or anywhere but `xref`, is `unreadable` (object streams only). `/Encrypt` in any trailer is `unreadable`. More than `maxPdfObjects` in-use entries is `limit_output`.
  - *Objects.* An object is read lazily at its xref offset, which must hold `n g obj` for the referenced number and generation (otherwise the xref is broken: `unreadable`). The lexer covers numbers, names with `#xx`, literal strings (nesting, escapes, octal, line continuation), hex strings, arrays, dictionaries, references, booleans and null, nested at most 64 deep. A stream's `/Length`, direct or indirect, must end its data right before `endstream`. A reference loop (such as a `/Length` that refers back into the object being read) is `unreadable`.
  - *Pages.* The catalog's `/Pages` tree is walked in order, with `/Resources` inherited, at most 64 levels deep. A node seen twice is `unreadable`, and more than `maxPdfPages` pages is `limit_output`.
  - *Content.* `/Contents` is one stream or an array of streams. A stream with no filter, or with `/FlateDecode` (as a name or a one-element array, with no predictor), is read; `/FlateDecode` runs through `inflateSync` with `maxOutputLength` = 20 MiB. A stream with any other filter is skipped. A decoded stream over 20 MiB, or more than 100 MiB decoded per artifact, is `limit_bytes`; a stream that fails to inflate is `unreadable`.
  - *Text.* `Tj`, `TJ`, `'` and `"` show literal and hex strings. A string that starts with `FE FF` is UTF-16BE, and any other string is Latin-1; C0 and C1 controls other than tab are dropped. A string shown in a `/Type0` (CID) font is not decoded. Inline image data (`BI … ID … EI`) is skipped. A new line starts at `T*`, `'` and `"`, and wherever the text line matrix moves vertically. A move along the same line, or a `TJ` gap of 200/1000 em or more, becomes a space. A content grammar error ends that page's content, and the lines read so far stand.
  - *Segments.* One segment per non-blank line, `{ kind: 'page', page }` (1-based). The locator carries no text and no line ordinal.
  - *Active content.* The upload's active-content names (`/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile`, `/RichMedia`, `/XFA`), matched as whole names as `sniff.ts` matches them, are `unreadable` (defence in depth).
- **Registry** (`worker/extract.ts`): `application/pdf` → `extractPdf`. PNG and JPEG stay unregistered, so they are always `unreadable` (no OCR, decision 8).
- **Tests** (26 new, 2 changed): `worker/pdf.test.ts` (22), `worker/hostile.test.ts` (+1, 1 changed), `worker/extract.test.ts` (1 changed), `client.test.ts` (+2, through the real fork), and `fixtures/src/evaluation/extraction.test.ts` (+1). `worker/pdf.test-helper.ts` is a test-only PDF writer (text pages, Flate, extra objects, xref stream, `/Prev` update, shifted offsets); its suffix keeps it out of the module graph.

## Done-when evidence

| Row item | Evidence |
| --- | --- |
| Text PDFs yield one `page` segment per line | `pdf.test.ts`: lines across pages with `{ kind: 'page', page }`; `'`, `"`, `TJ` spacing; `Td`/`TD`/`Tm` line breaks; separate text objects; escapes, octal, hex, UTF-16BE (Thai) in hex and literal strings; inherited and indirect resources; content arrays; indirect `/Length`; FlateDecode as a name and an array; inline images skipped; `/Prev` updates. `client.test.ts` shows the same through the forked worker (FlateDecode, two pages) |
| Encrypted PDFs → `unreadable` | `pdf.test.ts` (`/Encrypt` in the trailer); `client.test.ts` through the fork |
| Image-only PDFs → `unreadable` | `pdf.test.ts`: a page with only an image XObject, a page with only CID text, an empty page tree; `client.test.ts` through the fork; the W4-09a `pdf_image` and `pdf_cid` renderings |
| Broken PDFs → `unreadable` | `pdf.test.ts`: shifted xref offsets, xref stream only, a bad `startxref`, an out-of-range `startxref`, a bad entry type, no `%%EOF`, a bad header, a missing or direct `/Root`, a wrong `/Length`, a corrupt Flate stream, other filters on every stream, cycles and nesting past 64; a truncation at every byte and nine replacement values at every byte of two synthetic PDFs, each a clean reply; the W4-09a `pdf_broken_xref` rendering; `client.test.ts` through the fork |
| PNG/JPEG → `unreadable` | `extract.test.ts` and `hostile.test.ts` (every hostile row under both image types); `client.test.ts` through the fork |
| Limits (section 4.4) | pages over `maxPdfPages` and in-use objects over `maxPdfObjects` are `limit_output`; a decoded stream over `maxPartBytes` and decoded streams over `maxTotalBytes` (filtered or not) are `limit_bytes`; text over `maxTextChars` is `limit_output` |
| Hostile set | `hostile.test.ts`: every W0-08 row under the PDF type is a clean reply and every refused row is `ok: false`; the PDF rows (JavaScript, embedded file, no `%%EOF`) are rebuilt over a PDF with a text layer, so each refusal comes from the check itself |
| Evaluation set | `fixtures/src/evaluation/extraction.test.ts`: every `pdf` and `pdf_flate` rendering extracts, and every claim locator the renderer records names an extracted page segment; `pdf_image`, `pdf_cid` and `pdf_broken_xref` are `unreadable` |
| Module graph | `module-graph.test.ts` unchanged and green: `pdf.ts` imports only `node:buffer`, `node:zlib` and `./sink.js` |

## Performance (scratch, source layout through `tsx`, not committed)

| Input | Size | Time | Result |
| --- | --- | --- | --- |
| 100 pages × 400 lines, no filter | 2.5 MB | 51 ms | `limit_output` at the 2 000 000-character cap |
| the same, FlateDecode | 240 KB | 44 ms | `limit_output` |
| 2 000 pages sharing one 2 000-line stream | 286 KB | 52 ms | `limit_output` at 50 000 segments |
| one 1.9 M-character hex string | 3.8 MB | 205 ms | 1 segment |
| 1 M graphics operators, no text | 15 MB | 398 ms | `unreadable` |

All are far inside `QC_EXTRACT_TIMEOUT_MS=4000`. The built layout (`server/dist`, plain `node` under the permission model) extracts a two-line synthetic PDF through the fork in 26-28 ms, and `selfTest()` stays true.

## Deviations

These are choices made under Ta's delegation of 2026-09-27 where the plan is silent or does not fit. Each one keeps the plan's contracts.

- **What a "line" is.** The plan says one segment per text line but does not define a line. A line here is what the text operators draw at one vertical position: `T*`, `'` and `"` always start a line, as does any move of the line matrix in y. A move along the line, or a wide `TJ` gap, becomes a space. The current transformation matrix (`cm`) is not applied, because a line break inside one text object does not depend on it. The W4-09a renderer writes one `Tj` per line after `T*`, which this reads exactly.
- **Type0 fonts.** A string shown in a `/Type0` font is skipped rather than decoded as Latin-1, even when the font has a `/ToUnicode` CMap. Decoding its two-byte codes as Latin-1 would produce invented text that a content rule could match (plan section 4.3: CID text is not decoded). `ToUnicode` and `/Encoding` differences are not read for any font.
- **Active-content names refused.** The upload already refuses them, and the worker refuses them again, as W4-05c does for macro and nested ZIP entries. The hostile PDF rows are therefore refused by rule, not only because they carry no text.
- **Strict container.** A classic xref table is required and each offset must hold its own object header. Nothing reconstructs a damaged xref by scanning for `obj`. A lenient reader would read more broken files, but the plan lists a broken xref as unreadable, and reconstruction is more attack surface.
- **Filters.** `/FlateDecode` with a PNG or TIFF predictor is treated as an unsupported filter, since content streams do not use predictors. Undecoded streams count toward the 20 MiB and 100 MiB byte caps too, so an oversized plain stream is `limit_bytes` like a compressed one.
- **Form XObjects are not read.** Text drawn inside a form XObject (`Do` of a `/Form`) is not extracted. The plan names only page content streams; reading forms adds recursion for no current case (the W4-09a set draws text in page content only).
- **Changed test expectations (plan-driven).** `worker/extract.test.ts` "DOCX and XLSX are registered (W4-05c); PDF waits for W4-05d" and `worker/hostile.test.ts` "the registry holds DOCX and XLSX only; PDF and images stay unreadable until W4-05d" asserted a registry without PDF, which was true only until this ticket by their own messages. They now assert DOCX, XLSX and PDF, and that PNG and JPEG stay unreadable (the hostile test checks every row under both image types). Every media type is still `unreadable` for bytes that are not a document. The W4-05b client test "answers every media type as unreadable until W4-05c and W4-05d" still passes unchanged in body, because its five bytes are not a PDF; in round 1 only its out-of-date title became "answers every media type as unreadable for bytes that are not a document". No other existing test changed.
- No runner, config key, orchestrator change, migration or UI (W4-06a, W4-13b). No spec amendment is assigned to W4-05d.

### Deferred reviewer notes (round 1)

- `hasActiveContent` scans raw bytes, so it misses `#`-escaped names and names inside Flate bodies. Kept: defence in depth only; the upload sniff is the gate.
- `decodeText` drops 0x80-0x9F, so WinAnsi curly quotes, dashes and the euro sign are lost. Consistent with the Latin-1 rule; recorded for W4-08a.
- A content stream shared by several pages is inflated again and counted against `maxTotalBytes` once per page. Bounded and fails closed; left as is.
- A grammar error in a font dictionary met during content reading makes the whole file unreadable, as the stated rule says. Remark only.

## Commands and results

Worktree `/tmp/rai-w4-05d-pdf-text-layer-images`, Postgres project `rai-qc-content` on 55382. `rai-web/.env` comes from `.env.example` with the ports rewritten (8811/8812/8813/5192), `OBS_MIGRATION_ADMIN_URL` appended and `RAI_PG_TOOLS=docker-compose:rai-qc-content` (the W7-01 backup tests need this lane's container; the first integration run without it failed 4 W7-01 backup tests with `pg_tools_container_not_found`, an environment setting, not code). Logs are in `/tmp/rai-w4-05d-pdf-text-layer-images-logs/` (`rebased/` for the final run). Base: `origin/main` d86ed65, then rebased onto ed26e6d (W5-04; only the lane-a board conflicted, resolved by keeping both entries).

| Command (from `rai-web/` after `set -a; . ./.env; set +a`, unless noted) | Result |
| --- | --- |
| RED: `NODE_ENV=test node --import tsx --conditions=rai-source --test 'server/src/qc/extraction/**/*.test.ts' fixtures/src/evaluation/extraction.test.ts`, before the code | 118 tests, 95 pass, 23 fail for the right reason: PDF not registered, so every PDF came back `unreadable` (including the fork and evaluation-set tests) |
| same, after the code | 118/118 |
| `npm ci` | exit 0 |
| `npm run lint` | exit 0 (eslint, prettier check, check-css) |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` (d86ed65) | 950/950, 0 skipped |
| `npm run migrate` then `npm run test:integration` (d86ed65) | 404/404 with `RAI_PG_TOOLS` set, 0 skipped |
| `npm run build && npm run check:substitute-absent` (d86ed65) | exit 0; 843 files scanned, 0 with the marker |
| `npm run test:browser:server` (d86ed65) | 205 passed |
| `npm run test:browser:substitute` (d86ed65) | 48 passed |
| rebased on ed26e6d: `npm run lint` | exit 0 |
| rebased: `npm run typecheck` | exit 0 |
| rebased: `npm run test:unit` | 962/962, 0 skipped |
| rebased: `npm run migrate` then `npm run test:integration` | 413/413, 0 skipped |
| rebased: `npm run build && npm run check:substitute-absent` | exit 0; 851 files scanned, 0 with the marker |
| rebased: built-layout scratch script (`server/dist/qc/extraction/client.js`) | the synthetic PDF gives two `{ kind: 'page', page: 1 }` segments in 28 ms; `selfTest()` true |
| rebased: `npm run test:browser:server` | 205 passed |
| rebased: `npm run test:browser:substitute` | 48 passed |
| rebased: `node scripts/check-links.mjs` (root) | 428 Markdown files, 1208 relative links, 0 broken |
| rebased: `git diff --cached --check origin/main` (root, all files staged) | clean |
| round 1 RED: `npx tsx --test server/src/qc/extraction/worker/pdf.test.ts` with the 3000-deep `/Length` chain case added, before the fix | fails: `RangeError: Maximum call stack size exceeded` out of `extractInWorker` |
| round 1: same, after bounding nested object reads at 64 | 22/22 |
| round 1: reviewer probe (scratch, outside the repo), chains of 3 000 and 60 000 stream objects | both `{ ok: false, reason: 'unreadable' }` |
| round 1: `npm run lint` | exit 0 (first run flagged prettier on the new test lines; `prettier --write` on `pdf.test.ts` only) |
| round 1: `npm run typecheck` | exit 0 |
| round 1: `npm run test:unit` | 962/962, 0 skipped |
| round 1: `npm run migrate` then `npm run test:integration` | 413/413, 0 skipped |
| round 1: `npm run build && npm run check:substitute-absent` | exit 0; 851 files scanned, 0 with the marker |
| round 1: `npm run test:browser:server` | 205 passed |
| round 1: `npm run test:browser:substitute` | 48 passed |
| round 1: `node scripts/check-links.mjs` (root) | 428 Markdown files, 1208 relative links, 0 broken |
| round 1: `git diff --check` (root) | clean |

## Review verdicts

| Round | Head | Reviewer | Verdict | Notes |
| --- | --- | --- | --- | --- |
| 1 | 00f8658 | correctness reviewer | changes requested | A 3000-object chain of stream `/Length` references overflowed the stack in `PdfDocument.object` (a worker crash, not `unreadable`). Fixed: `object()` refuses a nested read once 64 objects are being read (`MAX_DEPTH`), and the deep-nesting test now carries the 3000-deep chain. |
| 1 | 00f8658 | second reviewer | pass with notes | Same stack overflow at 60 000 objects (note 1, fixed as above). Note 2 fixed: the DEVLOG now says CID-font text is skipped and a PDF with no other text is unreadable. The out-of-date `client.test.ts` title is fixed. Other notes deferred below. |
| - | - | - | pending | Two independent reviewer verdicts on the PR head, and green CI on that head, are recorded here before merge (D03 ticket flow). |
