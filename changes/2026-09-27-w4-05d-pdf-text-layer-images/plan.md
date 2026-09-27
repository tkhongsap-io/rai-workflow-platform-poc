# Plan

1. Board CLAIM (Lane A). Change frame (this folder).
2. RED (tests first, run and watched failing), under `rai-web/server/src/qc/extraction/`:
   - `worker/pdf.test-helper.ts`: a test-only PDF writer (pages of text operators, optional Flate, arbitrary extra objects and trailer entries, xref stream, `/Prev` update, broken offsets); excluded from the module graph by its suffix.
   - `worker/pdf.test.ts`: lines and page locators; `'`, `"`, `TJ` spacing, `Td`/`TD`/`Tm` line breaks; literal escapes and hex strings; UTF-16BE; Type0 text not decoded; inherited resources; content arrays; FlateDecode; unsupported filter; inline images; `/Prev`; every unreadable case; page, object and byte caps.
   - `worker/hostile.test.ts`: the PDF rows over a text-bearing PDF; the registry now holds PDF (plan-driven change).
   - `worker/extract.test.ts`: the registry holds DOCX, XLSX and PDF (plan-driven change).
   - `client.test.ts`: the real forked worker extracts a PDF and refuses encrypted, image-only and broken ones.
   - `fixtures/src/evaluation/extraction.test.ts`: the W4-09a PDF renderings.
3. GREEN: `worker/pdf.ts`, the registry.
4. Full gate, one suite at a time, logs under `/tmp/rai-w4-05d-pdf-text-layer-images-logs/`.
5. review.md, DEVLOG, CHANGELOG; commit, push, verify the remote head, open the PR ("Refs #227").
