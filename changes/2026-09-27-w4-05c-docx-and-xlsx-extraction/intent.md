# Intent: DOCX and XLSX extraction (W4-05c, #220)

W4-05b built the worker a document is read in, with an empty list of formats: every document came back unreadable. This ticket teaches the worker to read the two Office formats the desk accepts, Word (DOCX) and Excel (XLSX), so W4-06a's content rules have text to judge.

A Word document yields one segment per paragraph, located by its paragraph number. An Excel workbook yields one segment per non-empty cell, located by its sheet number and its cell reference (`B7`). No locator carries document text: no heading, no sheet name (decision 21, the W4-16 shape). The text itself stays in the worker's reply and the runner's memory; nothing is stored, logged or cached (decision 23).

The parsers are hand-written on Node built-ins (decision 8): a ZIP reader over the central directory that inflates with a hard output cap and checks sizes and CRCs, and an XML tokenizer that refuses a DOCTYPE and expands only the five predefined and numeric entities. Everything a hostile or broken file can do ends as a clean `ok: false` (`unreadable`, `limit_bytes` or `limit_output`), never a crash of the server: a DOCTYPE, a decompression bomb, an inconsistent ZIP, and every row of the W0-08 hostile set. The host's `selfTest()` now extracts an embedded synthetic DOCX, so W4-13b's readiness probe proves a real parse.

It implements the W4-05c row of the [W4b plan](../../docs/engineering/implementation-plan-w4b.md) (sections 4.3 and 4.4) under the provisional ADR-0006. PDF and images are W4-05d. Synthetic data only; no network call; nothing deploys.
