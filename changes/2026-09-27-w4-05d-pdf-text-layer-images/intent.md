# Intent: PDF text layer; images unreadable (W4-05d, #227)

W4-05c taught the extraction worker to read Word and Excel files. PDFs still came back unreadable. This ticket teaches the worker to read the text layer of a PDF, so W4-06a's content rules have text to judge in the format most reviewers submit.

A PDF yields one segment per text line, located by its 1-based page number (`{ kind: 'page', page }`). The locator carries no document text and no line ordinal (decision 21, the W4-16 shape; section 4.3 of the W4b plan). The text itself stays in the worker's reply and the runner's memory; nothing is stored, logged or cached (decision 23).

The reader is hand-written on Node built-ins (decision 8): the classic cross-reference table and trailer, indirect objects, the `Pages` tree, and content streams with no filter or `/FlateDecode` (inflated with a hard output cap). It reads the text-showing operators `Tj`, `TJ`, `'` and `"` with literal and hex strings, decoded as Latin-1, or as UTF-16BE when the string starts with a byte-order mark. It does no OCR (decision 8), and it does not decode CID fonts, so Thai text in such fonts is not read.

Everything a hostile or broken PDF can do ends as a clean `ok: false`, never a crash of the server. An encrypted PDF, one with only a cross-reference stream (object streams), one whose content streams all use other filters, a broken cross-reference, and a scan with no text on any page are all `unreadable`. Page and object counts over the fixed caps are `limit_output`. PNG and JPEG stay unregistered and are always `unreadable`.

It implements the W4-05d row of the [W4b plan](../../docs/engineering/implementation-plan-w4b.md) (sections 4.3 and 4.4) under the provisional ADR-0006. Synthetic data only; no network call; nothing deploys.
