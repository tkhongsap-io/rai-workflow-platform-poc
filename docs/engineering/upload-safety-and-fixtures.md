# Upload safety policy and synthetic fixture strategy (W0-08)

**Status:** Proposed for Ta's acceptance at the W0 exit review ([W0-09](../delivery/w0-technical-contract.md#w0-09--verification-commands-budgets-and-exit-review)), for **synthetic data only**. IT/Security is "to be named" in [team and roles](../delivery/team-and-roles.md) as of 2026-09-21, so under the W0-08 dependency rule Ta accepts the list and limits for synthetic data; **D08** (DPO + IT/Security) revisits every limit, the malware-scanning question and the retention of rejected-upload records before any real data enters the desk. Nothing here is a real-data acceptance.
**Ticket:** W0-08 ([issue #13](https://github.com/tkhongsap-io/rai-workflow-platform-poc/issues/13)), lane Lead, owner type Human review required. Proves A01 (direct-file negative) and the [threat model](../security/threat-model.md) rows "malicious archive/PDF, oversized upload or decompression bomb" and "owner reads another BU's case via download".
**Stack:** concrete for [ADR-0003](../../adr/0003-stack-and-deployment-boundary.md) (D04: Fastify, Drizzle, Postgres 16, node:test, Playwright). The boundary (bytes are untrusted until sniffed, hashed and authorized) is stack-neutral; only the "How it maps to the stack" subsections name libraries.
**Consumed by:** W1-00 (fixture users, `operator_recipients` seed), W1-01 (identity substitute), W1-03 (upload and download), W1-04 (slot defaults), W1-09 (fixture generator and loader), W1-10 (finding scripts keyed by fixture artifact ID), W1-11 (operator address in the mail sink), W1-13 (UI substitute data), W1-INT and W1-08 (negative tests), W3-01 (Thai search), W3-03 (Thai subject), W7-00 (backup of the blob root). Ticket rows are in the [slice 1 work breakdown](../delivery/slice-1-work-breakdown.md).
**Related W0 specs:** [W0-02](../delivery/w0-technical-contract.md#w0-02--file-level-implementation-plan) (paths, commands, env names, pinned dependencies, fixture identity convention in the test-layer map), [W0-03](../delivery/w0-technical-contract.md#w0-03--identity-adapter-spec) (identity shape, dual-role identity), [W0-04](../delivery/w0-technical-contract.md#w0-04--persistence-and-artifact-store-spec) (blob interface, metadata, staging cleanup, deletion options), [W0-05](../delivery/w0-technical-contract.md#w0-05--authorization-policy-matrix) (download follows case-view scope), [W0-06](../delivery/w0-technical-contract.md#w0-06--workflow-transition-and-error-contract) (error types; draft-only uploads), [W0-07](../delivery/w0-technical-contract.md#w0-07--qc-boundary-and-mail-sink) (on-upload QC trigger, mail sink), [W0-10](../delivery/w0-technical-contract.md#w0-10--observability-contract-for-the-desk-runtime) (redacted log event on rejection). Those specs are written in parallel; where this document proposes a name that one of them owns (an env variable, a command, a shared type field), the owning spec's name wins and this document is corrected at W0-09.

## 1. What this document decides and what it does not

Decides, for synthetic data:

1. the allowed upload types and the byte-level check that admits them (section 2);
2. the per-file, per-pack and structural limits (section 3);
3. the order of checks, the safe error and what is recorded on rejection (sections 4 and 5);
4. how admitted bytes are stored and served so that a download is never a second, unauthorized path to a document (section 6);
5. the synthetic fixture set: seven identities, four cases, their documents, the hostile negative set, how they are generated inside the repository and how evidence cites them (section 8).

Does not decide: real-data limits, malware scanning, retention of rejected uploads or blob deletion (**D08**); the production host's disk and backup (**D10**); slot cardinality and the pack data model (W1-04 under W0-04); the authorization rows themselves (W0-05); the request/response field names of the shared package (W0-02). D07-D10 are not resolved here.

Source rules this policy implements as written: nine slots with four dispositions and the non-vendor N/A default on slots 3 and 4 ([source spec](../product/source-spec.md) "Pack and lanes"); submitted versions immutable and artifacts keyed by content hash (W0-04); `unsafe_upload` = HTTP 422 with code `unsafe_upload` ([ADR-0003](../../adr/0003-stack-and-deployment-boundary.md#contract-error-codes-chosen-here-for-w0-06)); every user-facing message carries a locale key, Thai default (D12); synthetic data only (D03); `operator_recipients` seeded from configuration in slice 1 (D06).

## 2. Allowed types and the sniffing rule

**Deny by default.** A file is admitted only when its **bytes** match exactly one row of the table below and its declared filename extension belongs to that same row. The browser's `Content-Type` part header is never consulted; it is untrusted input. The extension alone never admits a file; the bytes alone never admit a file either, because a permitted document arriving under a misleading extension is a mismatch the uploader must correct (reason `type_mismatch`).

| Kind | Extensions (case-insensitive) | Stored media type | Magic (offset 0) | Structural check on the full bytes |
|---|---|---|---|---|
| PDF | `.pdf` | `application/pdf` | `%PDF-1.` or `%PDF-2.` (7 bytes + digit) | `%%EOF` appears within the last 1,024 bytes; the byte scan for active content (2.1) finds nothing |
| DOCX | `.docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | `50 4B 03 04` (`PK\x03\x04`) | ZIP container rules (2.2) pass; the central directory lists `[Content_Types].xml` and `word/document.xml` and does not list `xl/workbook.xml` |
| XLSX | `.xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | `50 4B 03 04` | ZIP container rules (2.2) pass; the central directory lists `[Content_Types].xml` and `xl/workbook.xml` and does not list `word/document.xml` |
| PNG | `.png` | `image/png` | `89 50 4E 47 0D 0A 1A 0A` (8 bytes) | The first chunk at offset 8 is `IHDR` with length 13; width and height are each ≥ 1 and width × height ≤ 40,000,000; the file ends with the 12-byte `IEND` chunk (`00 00 00 00 49 45 4E 44 AE 42 60 82`) and nothing follows it |
| JPEG | `.jpg`, `.jpeg` | `image/jpeg` | `FF D8 FF` (3 bytes) | Marker walk from offset 2 reaches a `SOF0`, `SOF1` or `SOF2` frame header (`FF C0`, `FF C1`, `FF C2`) whose height × width ≤ 40,000,000 before the scan data starts; the last two bytes are `FF D9` |

The stored media type comes from the row, never from the request. Downloads (section 6) serve exactly that value.

### 2.1 PDF active-content scan

After the magic and `%%EOF` checks, the whole byte stream (at most the per-file limit) is scanned for any of the tokens `/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile`, `/RichMedia`, `/XFA`. A hit rejects with reason `active_content`. This is a byte-level, defence-in-depth check: it does not decompress object streams, so it can miss a token hidden inside a compressed stream, and it can reject a benign PDF that happens to carry an embedded attachment. Both are accepted for synthetic data. The primary controls against a malicious PDF are that the server never parses or renders PDF contents in slice 1 (QC is a scripted substitute, W0-07) and that a download is always an attachment under `Content-Security-Policy: sandbox` (section 6). D08 decides whether real data needs a proper PDF parser in an isolated worker (W4, ADR-0006) and whether embedded files are ever legitimate for the desk.

### 2.2 ZIP container rules (DOCX and XLSX)

The check reads the local file header at offset 0 and the **central directory**; it never inflates an entry in slice 1. Each rule rejects on failure with the reason in brackets:

- The end-of-central-directory record (`50 4B 05 06`) is found within the last 65,557 bytes and `offset(EOCD) + 22 + comment length == file length`; the first local file header sits at offset 0. Together these refuse polyglots (a JPEG with a ZIP appended, or vice versa). [`container_invalid`]
- No ZIP64 end-of-central-directory locator (`50 4B 06 07`); a document under the per-file limit never needs ZIP64. [`container_invalid`]
- Entry count ≤ 2,000; every entry's declared uncompressed size ≤ 100 MiB; the sum of declared uncompressed sizes ≤ 500 MiB. These bound what any later parser (W4) would inflate; W1 inflates nothing. [`container_invalid`]
- Every entry uses compression method 0 (stored) or 8 (deflate). Method 99 (AES) and any other method are refused. [`container_invalid`]
- No entry has general-purpose bit 0 set (encrypted). [`encrypted_entry`]
- No entry name contains a NUL byte, a backslash, a `..` path segment or starts with `/`. [`container_invalid`]
- No entry is named `vbaProject.bin` in any directory (case-insensitive), and `[Content_Types].xml` does not declare a `macroEnabled` content type. Macro-enabled packages (`.docm`, `.xlsm`, `.dotm`, `.xltm`) are also refused by extension before the bytes are read. [`macro_enabled`]
- No entry name ends with an archive or executable extension from section 2.3 (for example an embedded `.zip`, `.exe` or `.js` inside `word/embeddings/`). OLE embeddings (`.bin`) other than `vbaProject.bin` are allowed for synthetic data; D08 decides for real data. [`nested_archive`]
- The package kind (DOCX or XLSX) is determined by the presence of `word/document.xml` versus `xl/workbook.xml`, exactly one of them, and must match the declared extension. [`type_mismatch` when the other kind's extension is declared; `container_invalid` when neither or both are present]

### 2.3 Rejected outright

Everything not in the section 2 table is rejected. The following are named so that tests cover them and so that the rejection reason is specific rather than generic:

| Class | How it is recognised | Reason |
|---|---|---|
| Archives: `.zip`, `.7z`, `.rar`, `.tar`, `.gz`, `.tgz`, `.bz2`, `.xz`, `.iso`, `.cab`, `.jar`, `.apk` | Extension; or magic `50 4B 03 04` without the OOXML markers, `37 7A BC AF 27 1C` (7z), `52 61 72 21` (RAR), `1F 8B` (gzip), `42 5A 68` (bzip2), `FD 37 7A 58 5A 00` (xz), `75 73 74 61 72` at offset 257 (tar) | `extension_not_allowed` by name; `type_not_allowed` or `container_invalid` by bytes |
| Executables and scripts: `.exe`, `.dll`, `.msi`, `.com`, `.scr`, `.bat`, `.cmd`, `.ps1`, `.sh`, `.js`, `.mjs`, `.vbs`, `.hta`, `.lnk`, `.app`, `.dmg`, `.pkg` | Extension; or magic `4D 5A` (PE), `7F 45 4C 46` (ELF), `CF FA ED FE` / `CE FA ED FE` / `CA FE BA BE` (Mach-O), `23 21` (`#!`) | `extension_not_allowed` by name; `type_not_allowed` by bytes |
| Macro-enabled Office: `.docm`, `.xlsm`, `.dotm`, `.xltm`, `.pptm` | Extension; or `vbaProject.bin` in a package | `extension_not_allowed`; `macro_enabled` |
| Legacy binary Office: `.doc`, `.xls`, `.ppt`, `.rtf` | Extension; or OLE magic `D0 CF 11 E0 A1 B1 1A E1` | `extension_not_allowed`; `type_not_allowed` |
| Browser-active text: `.html`, `.htm`, `.svg`, `.xml`, `.xhtml`, `.mht` | Extension; or bytes beginning (after optional BOM and whitespace) with `<` | `extension_not_allowed`; `type_not_allowed` |
| Other images and media: `.gif`, `.webp`, `.bmp`, `.tiff`, `.heic`, `.mp4`, `.mov` | Extension or magic | `extension_not_allowed`; `type_not_allowed` |
| Anything else, including files with no extension or a double extension whose last part is not allowed (`report.pdf.exe`) | Last extension only is considered; it must be in the section 2 table | `extension_not_allowed` |

A file whose extension is allowed but whose bytes are not (an executable renamed `.pdf`) is `type_not_allowed`; a file whose bytes are one allowed kind under another allowed kind's extension (a real PNG named `.pdf`) is `type_mismatch`. W1-03's done-when "an executable disguised by extension is rejected with the unsafe-upload error" is the first of these.

### 2.4 What is deliberately not checked in slice 1

No antivirus or malware signature scan, no OCR, no rendering, no PDF object parsing, no XML parsing of OOXML parts, no image decoding. These are stated so nobody reads the sniff as a malware guarantee. Whether real data needs a host scanner (for example ClamAV on the True host) or a parsing worker is a **D08/D10** question recorded in section 10.

### 2.5 How the sniff maps to the stack

The sniff is a pure module: `(bytes: Buffer, declaredFilename: string) → { ok: true, kind, mediaType } | { ok: false, reason }`. It uses only Node built-ins (`node:buffer`). No third-party detector (`file-type`, `mmmagic`, a ZIP library) is added: the allow-list is five explicit structures, deny-by-default is easier to audit as plain code than as a broad detector's output, and it keeps the W0-02 pinned dependency list unchanged apart from `@fastify/multipart`. The module has no I/O and is unit-tested with `node:test` against the hostile set in section 8.6. Reconsidering a library detector is a D08 item.

## 3. Limits (proposed for Ta at W0-09)

| Limit | Value | Where enforced | Reason |
|---|---|---|---|
| Per file | 25 MiB (26,214,400 bytes) | `@fastify/multipart` `limits.fileSize`; the stream is aborted at the first byte over the limit and the staging file removed | A nine-document pack of checklists, a BRD and an architecture PDF fits comfortably; large enough that a scanned signed DPA passes, small enough to hold in a temp file and hash in one pass |
| Per pack version | 150 MiB total over every artifact the version references, including artifacts carried forward into a successor draft (D05 merge) and every artifact in slot 9, whatever cardinality W1-04 records for slot 9 | Server, after the sniff and before the blob write, in the same transaction that records the artifact | Bounds a version's download and backup size (W7-00) and the reviewer's own machine |
| Files per request | 1 | `limits.files: 1` | One slot, one artifact, one audit event; the pack total is checked without races |
| Non-file multipart fields | ≤ 4 fields, ≤ 1 KiB each (`slot`, `expected_version`, `idempotency_key`, `filename` if the client sends it separately) | `limits.fields`, `limits.fieldSize` | Keeps the multipart parser from being used as a JSON channel |
| Empty file | 0 bytes rejected | Server | `empty_file`; no zero-byte blob is ever stored |
| Image pixels | width × height ≤ 40,000,000 | Sniff (PNG `IHDR`, JPEG `SOF`) | Decompression-bomb guard for any later viewer or parser; a 25 MiB PNG can declare a 100,000 × 100,000 canvas |
| ZIP container | ≤ 2,000 entries; ≤ 100 MiB per entry; ≤ 500 MiB total declared uncompressed | Sniff (central directory) | Decompression-bomb guard; nothing inflates in W1 |
| Filename | ≤ 200 Unicode code points after NFC normalisation; no `/`, `\`, NUL, U+0000-U+001F, U+007F; no leading or trailing whitespace; not `.` or `..`; must end with an allowed extension | Server, before the bytes are read | Thai filenames (up to 3 bytes per code point in UTF-8) fit inside Postgres and the `filename*` download header; path characters are refused rather than stripped so the uploader sees what was wrong |
| Request body time | 120 s per upload request | Fastify `connectionTimeout` / route config, confirmed as a W0-09 budget | A stalled client does not hold a staging file open indefinitely |
| In-flight uploads per session | Not set here; W0-09 performance budgets | — | Recorded as a target with the workload numbers, not a policy value |

Values are configuration read at start (proposed env names, W0-02 owns the list: `UPLOAD_MAX_FILE_BYTES`, `UPLOAD_MAX_PACK_BYTES`, `UPLOAD_MAX_IMAGE_PIXELS`). The defaults are the values above; a configured value larger than the default is refused at start in `local-google` and test modes so that a local override cannot quietly widen the policy. Raising them for real data is a D08 change, not a config edit.

## 4. Order of checks

An upload is a `multipart/form-data` POST to the draft version's slot (route shape and field names in the W0-02 "W1 interface shapes" section). The server runs these in order and stops at the first failure. Numbers 1-4 fail before any file byte is read.

| # | Check | On failure (code from ADR-0003) |
|---|---|---|
| 1 | Session present | 401 `unauthenticated` |
| 2 | Actor may create/edit/submit on this case (owner or BU SPOC in scope, W0-05) | 403 `forbidden` |
| 3 | Target version is the case's current draft and equals `expected_version` (W0-06); a submitted version is immutable and never accepts bytes | 409 `stale_version` (mismatch) or 422 `invalid_input` (not a draft); W0-06 confirms which applies when the client names a submitted version explicitly |
| 4 | `slot` is 1-9; declared filename passes the section 3 filename rule and its extension is allowed | 422 `invalid_input` for slot; 422 `unsafe_upload` `filename_invalid` / `extension_not_allowed` |
| 5 | Bytes stream to `<BLOB_ROOT>/staging/<uuid>` while SHA-256 is computed on the stream; the per-file limit aborts at limit + 1 | 422 `unsafe_upload` `too_large`; staging file unlinked |
| 6 | Byte count > 0 | 422 `unsafe_upload` `empty_file` |
| 7 | Magic sniff on the first 8 KiB (section 2 table, section 2.3 magics) | 422 `unsafe_upload` `type_not_allowed` |
| 8 | Sniffed kind matches the declared extension's row | 422 `unsafe_upload` `type_mismatch` |
| 9 | Structural check on the full staging file (2.1 PDF scan, 2.2 ZIP rules, PNG/JPEG rules) | 422 `unsafe_upload` with the specific reason (`container_invalid`, `macro_enabled`, `nested_archive`, `encrypted_entry`, `active_content`, `image_too_large`) |
| 10 | Per-pack total after adding this file ≤ 150 MiB, computed inside the transaction with the version row locked (`SELECT ... FOR UPDATE`) | 422 `unsafe_upload` `pack_total_exceeded` |
| 11 | Blob store `put(hash, stagingPath)` (W0-04 interface): atomic rename into the object directory, or discard the staging file when the hash already exists and the existing object's size matches | 500 internal (not an upload reason); staging file unlinked; audit not written because the transaction rolls back |
| 12 | Same transaction: artifact row (filename, media type from the row, size, SHA-256, uploader subject, time, slot, version) and the audit event with the request correlation ID; slot disposition becomes `attached` | Transaction rollback; the object written in 11 is orphan-safe (content-addressed, unreferenced; cleaned by the W0-04 failed-upload rule) |
| 13 | After commit: the on-upload QC trigger (W0-07; scripted substitute in slice 1) receives the version and artifact references | QC failure is an `unavailable` finding, never an upload failure |

The multipart parser's own limit error (`FST_REQ_FILE_TOO_LARGE`, HTTP 413 by default) is mapped to 422 `unsafe_upload` `too_large` so that every unsafe-byte outcome has one code, as ADR-0003 records. `invalid_input` and `unsafe_upload` share HTTP 422 and are told apart by `code`.

## 5. The safe error

Response body for every `unsafe_upload` (field names are the W0-02 shared error shape; this document owns the `reason` list):

```ts
type UnsafeUploadReason =
  | 'empty_file' | 'too_large' | 'pack_total_exceeded'
  | 'filename_invalid' | 'extension_not_allowed'
  | 'type_not_allowed' | 'type_mismatch'
  | 'container_invalid' | 'macro_enabled' | 'nested_archive' | 'encrypted_entry'
  | 'active_content' | 'image_too_large';

type UnsafeUploadError = {
  code: 'unsafe_upload';
  reason: UnsafeUploadReason;
  message_key: `error.unsafe_upload.${UnsafeUploadReason}`;
  correlation_id: string;
  limits?: { max_file_bytes: number; max_pack_bytes: number; max_image_pixels: number };
};
```

Safe means: no stack trace, no library error text, no internal path, no echo of the bytes or of the magic found, no hint of which other case exists. The declared filename is not echoed either; the client already has it. `limits` is included only for `too_large`, `pack_total_exceeded` and `image_too_large` so the message can state the number.

Initial locale strings (D12, Thai default; Lane B keeps them in the locale files, this table is the source for W1-03 and W1-06):

| Key | th | en |
|---|---|---|
| `error.unsafe_upload.empty_file` | ไฟล์ว่างเปล่า ไม่มีการจัดเก็บข้อมูลใด ๆ | The file is empty. Nothing was stored. |
| `error.unsafe_upload.too_large` | ไฟล์มีขนาดเกินขีดจำกัด {max_file_mb} MB ไม่มีการจัดเก็บข้อมูลใด ๆ | The file exceeds the {max_file_mb} MB limit. Nothing was stored. |
| `error.unsafe_upload.pack_total_exceeded` | การแนบไฟล์นี้จะทำให้ขนาดรวมของชุดเอกสารเกิน {max_pack_mb} MB | Attaching this file would take the pack over its {max_pack_mb} MB total. |
| `error.unsafe_upload.filename_invalid` | ชื่อไฟล์ไม่ถูกต้อง กรุณาลบอักขระพาธและอักขระควบคุมออก และใช้ชื่อไม่เกิน 200 อักขระ | The file name is not allowed. Remove path and control characters and use at most 200 characters. |
| `error.unsafe_upload.extension_not_allowed` | รับเฉพาะไฟล์ PDF, DOCX, XLSX, PNG และ JPEG เท่านั้น | Only PDF, DOCX, XLSX, PNG and JPEG files are accepted. |
| `error.unsafe_upload.type_not_allowed` | เนื้อหาของไฟล์ไม่ใช่ประเภทเอกสารที่อนุญาต | The file content is not a permitted document type. |
| `error.unsafe_upload.type_mismatch` | เนื้อหาของไฟล์ไม่ตรงกับนามสกุลไฟล์ | The file content does not match its extension. |
| `error.unsafe_upload.container_invalid` | ไฟล์เสียหายหรือไม่ใช่เอกสารที่ถูกต้อง | The file is damaged or is not a valid document. |
| `error.unsafe_upload.macro_enabled` | ไม่รับเอกสารที่มีมาโคร | Documents containing macros are not accepted. |
| `error.unsafe_upload.nested_archive` | ไม่รับเอกสารที่มีไฟล์บีบอัดหรือโปรแกรมอยู่ภายใน | Documents containing archives or programs are not accepted. |
| `error.unsafe_upload.encrypted_entry` | ไม่รับเอกสารที่เข้ารหัส | Encrypted documents are not accepted. |
| `error.unsafe_upload.active_content` | ไม่รับไฟล์ PDF ที่มีสคริปต์ การเรียกใช้โปรแกรม หรือไฟล์ฝังตัว | PDF files with scripts, launch actions or embedded files are not accepted. |
| `error.unsafe_upload.image_too_large` | ภาพมีขนาดเกิน {max_megapixels} ล้านพิกเซล | The image exceeds {max_megapixels} megapixels. |
| `error.unsafe_upload.generic` | ไม่สามารถรับไฟล์ได้ ไม่มีการจัดเก็บข้อมูลใด ๆ | The file was not accepted. Nothing was stored. |

### 5.1 What a rejection records

A rejection changes no state, so it writes **no audit event** (audit events describe state changes, W0-04). It writes one structured log event under the W0-10 contract: `event: upload_rejected`, `correlation_id`, `case_id`, `version_id`, `slot`, `reason`, `sniffed_kind` (or `none`), `declared_extension`, `size_bytes`, `actor_subject`. It never logs the filename (it may carry personal data), the bytes, the hash of rejected bytes or any token found. The staging file is unlinked before the response is sent. Whether rejected uploads should be counted per actor or retained for IT/Security review is a D08 question.

## 6. Storage and download safety

The blob interface and metadata are W0-04's; this section fixes the safety properties an upload relies on.

- **Key.** SHA-256 of the bytes, lower-case hex, computed on the upload stream. Path `<BLOB_ROOT>/objects/<h[0:2]>/<h[2:4]>/<h>` with **no extension**, so nothing on disk is executable or double-clickable by type. `<BLOB_ROOT>` is outside the repository and outside every directory Fastify serves statically (the SPA is served from the built `web` output only, W0-02); the directory is created with mode `0700`, objects `0400`.
- **Write.** Staging file → `fsync` → atomic `rename` into `objects/`. A second upload of identical bytes finds the object and discards its staging copy; the artifact row is still written, so two slots or two versions may reference one object. Objects are never overwritten and, in slice 1, never deleted (deletion design is W0-04's D08 options: tombstone, redaction event or key destruction, none chosen here).
- **Staging cleanup.** `<BLOB_ROOT>/staging/` is emptied at process start and by the W0-04 failed-upload cleanup rule; an object in `objects/` referenced by no artifact row is reported by the W7-00 integrity check, not deleted automatically.
- **Download** is one authorized route, `GET /api/.../artifacts/<artifact_id>/content` (exact path in W0-02): session (401), case-view scope (403, W0-05 "file download follows case-view scope"), artifact belongs to a version of that case (404 in scope, 403 out of scope until W0-05 records the 403-or-404 choice from ADR-0003). Response headers: `Content-Type` = the stored media type from the section 2 row; `Content-Length` from the artifact row; `Content-Disposition: attachment; filename="<ASCII fallback>"; filename*=UTF-8''<RFC 8187 percent-encoded NFC filename>` so a Thai filename round-trips (W1-03 done-when); `X-Content-Type-Options: nosniff`; `Content-Security-Policy: sandbox`; `Cache-Control: no-store`; `Referrer-Policy: no-referrer`. No inline rendering, no preview endpoint, no Range support in slice 1. The ASCII fallback is the filename with every non-ASCII code point replaced by `_`, never empty (falls back to `artifact-<slot>.<ext>`).
- **Integrity.** The hash is verified on write (the stream hash is the key). A download streams the object as stored; the W1-03 test "downloaded bytes match the stored hash" proves the path end to end, and the W7-00 backup rehearsal re-hashes every object. Verifying the hash on every download is not required in slice 1 (cost) and can be enabled by configuration for audits.
- **Thai filenames.** Stored NFC-normalised as the artifact's `filename`; search (W3-01) and mail subjects (W3-03) read that field. The object key never depends on the filename.

### 6.1 How it maps to the stack

`@fastify/multipart` in stream mode with the section 3 `limits` (`attachFieldsToBody: false`, `throwFileSizeLimit: true`); `node:crypto` `createHash('sha256')` piped alongside the staging write; `node:fs/promises` `rename` for the atomic move; Drizzle transaction with `FOR UPDATE` on the version row for check 10 and the artifact and audit inserts in check 12; the download route uses `reply.send(fs.createReadStream(path))` with the headers above. `@fastify/static` is registered only for the built SPA directory with `serve: false` elsewhere; no route exposes `<BLOB_ROOT>`.

## 7. Threat-model mapping

| Threat ([threat model](../security/threat-model.md)) | Control in this policy | Proven by |
|---|---|---|
| Malicious archive/PDF | Deny-by-default allow-list; extension and byte sniff must agree; ZIP central-directory rules refuse nested archives, executables, macros, encryption, polyglots; PDF active-content scan; no server-side parsing or rendering; attachment download under `sandbox` and `nosniff` | W1-03 unit tests on the hostile set (8.6); W1-08 negative "unsafe upload" |
| Oversized upload or decompression bomb | Per-file limit aborts the stream; pack total in the transaction; image pixel cap; ZIP entry and declared-size caps | W1-03 tests at 25 MiB and 25 MiB + 1; PNG `IHDR` 100,000 × 100,000; ZIP with a 1 GiB declared entry |
| Owner reads another BU's case via download | Download only through the authorized route with case-view scope; blob directory never served; keys are hashes, not guessable case IDs, and a hash alone still needs a session and scope | W1-03 "direct file URL without an authorized session is refused"; W1-INT cross-BU download negative |
| Document tells model to approve or reveal another case | Bytes are never parsed by a model in slice 1; QC substitute is scripted (W0-07); W4 isolation is ADR-0006 | W1-10 test "no write path to workflow state" |
| Credentials/PII in logs | Rejection log carries reason and sizes, never filename or bytes (5.1); W0-10 redaction rule | W1-03 log-shape test |
| Stale approval / immutable versions | Uploads only to the current draft with `expected_version`; a submitted version never accepts bytes; objects never overwritten | W1-03 / W1-05 "submitted bytes cannot be overwritten" (A07) |

## 8. Synthetic fixture strategy

### 8.1 Principles

1. **Synthetic only, generated inside the repository.** Every fixture user, case, document and address is produced by a generator script from a manifest committed in the fixtures package (proposed `rai-web/fixtures`, path assigned by W0-02). No content is copied from real cases, from Life-OS evidence (the sources in [docs/sources.md](../sources.md) are referenced, never copied) or from any real document. Names are invented; business units are synthetic labels; addresses use the reserved domain `rai-desk.example` (RFC 2606) so nothing can ever route to a real mailbox.
2. **No committed binaries.** The fixtures package contains only source (`.ts`), the manifest (`.json`) and this strategy's README. Documents are generated deterministically into a git-ignored output directory by `npm run fixtures:generate` (command name proposed to W0-02). This keeps real documents out of Git by construction and keeps virus scanners away from the repository.
3. **Deterministic and identifiable.** The generator uses fixed timestamps, stored (uncompressed) ZIP entries and level-0 zlib streams, so the same manifest yields the same bytes on every Node 24 run; each document's SHA-256 is recorded in the manifest and checked by a test. Every generated document contains the sentinel string `RAI-DESK-SYNTHETIC-FIXTURE` and its own fixture ID in plain bytes (PDF text stream, uncompressed OOXML part, PNG `tEXt` chunk, JPEG `COM` segment), so provenance is greppable and a document's fixture identity survives download.
4. **Fixtures never fake a transition.** The loader (`npm run fixtures:load`, W1-09) inserts identities, configuration seed, cases, draft versions, slot dispositions, objects and artifact rows. It never inserts a submitted version, a lane decision, a finding or a disposition: any such state is produced through the real transition by the test that needs it (W1-05 onward), so no fixture ever contains a fabricated audit trail (A11).
5. **Test and development only.** The loader refuses to run unless the runtime environment is `development` or `test` (env name from W0-02) and the identity mode is `local-google` or the fixture provider; it refuses a non-empty database unless `--reset` is passed. Fixture identities exist only in the W0-03 fixture identity provider, never in `network` or `production` mode.
6. **Evidence cites the fixture identity.** `fixture_set_id` is `rai-fx-1`; the manifest's SHA-256 is printed by `fixtures:generate` and recorded in every `changes/<date>-<slug>/review.md` that uses the set. Any change to the manifest or generator bumps the ID (`rai-fx-2`); old evidence keeps citing the old ID. This is the fixture identity convention the W0-02 test-layer map references.

### 8.2 Identities (owned by W1-00; shape from W0-03)

Six single-role users, one per role, plus the W0-03 dual-role identity. Subjects are stable strings; `email` is the address the fixture identity provider returns and the mail sink addresses; all are at `rai-desk.example`.

| Subject | Display name | Email | Role(s) and scope | Notes |
|---|---|---|---|---|
| `fx-owner` | Nattaporn S. (นัทธพร ส.) | `fx-owner@rai-desk.example` | Owner: cases it owns (all four below) | The one owner; two cases in each fixture BU so owner scope is proven to follow ownership, not BU |
| `fx-spoc-cm` | Suchada P. | `fx-spoc-cm@rai-desk.example` | BU SPOC: `bu-cm` | Submits the second case in W1-INT's positive SPOC test |
| `fx-coe` | Dr. Anan V. | `fx-coe@rai-desk.example` | AI/COE reviewer: all cases | |
| `fx-dpo` | Pimchanok R. | `fx-dpo@rai-desk.example` | DPO reviewer: all cases | |
| `fx-sec` | Wutthichai K. | `fx-sec@rai-desk.example` | IT/Security reviewer: all cases | |
| `fx-admin` | Desk admin (synthetic) | `fx-admin@rai-desk.example` | Admin: configuration; read-only case view per W0-05; never a lane decision or disposition | |
| `fx-dual-coe-spoc-rpc` | Thanwa R. | `fx-dual-coe-spoc-rpc@rai-desk.example` | AI/COE reviewer: all cases **and** BU SPOC: `bu-rpc` | The W0-03 dual-role identity. It is BU SPOC on `RAI-FX-0002` and `RAI-FX-0004`, so under D05 it may never approve the AI/COE lane on those two cases and may approve it on `RAI-FX-0001` and `RAI-FX-0003`. Whether "BU SPOC on a case" means scope alone or a recorded action on the case is W0-05's to state; both readings are exercisable because the identity both holds the scope and, in the W2 journey, submits `RAI-FX-0004` |

Business units: `bu-cm` "Consumer Mobile" and `bu-rpc` "Retail & Partner Channels", the labels the synthetic demo already uses. They are fixture labels; if either turns out to match a real unit's name in a way Ta considers misleading, W1-09 renames them (its done-when already includes a reviewer's provenance check) without changing the subjects above.

Operator recipient (D06 `operator_recipients` seed, W1-00): exactly one address, `operator-digest@rai-desk.example`. It is used only by the local mail sink (W1-11, W3-03) and appears in no other fixture. No real operator address is ever seeded.

Display names: one carries Thai script so the UI, audit trail and mail templates are exercised with Thai from the first fixture; the rest are Latin-script transliterations, all invented.

### 8.3 Cases (owned by W1-09)

All four are owned by `fx-owner`. `checklist_template_version` is `v1.0 Sheet3` unless stated. `source_record_id` is either a synthetic `AIR-FX-nnnn` string or `Unknown` (L10; never an invented official record). `use_case_group` values must exist in the W1-00 configuration seed: `customer-analytics`, `customer-service`, `field-operations`.

| Case | `use_case_name` | BU (SPOC) | `vendor_involved` | `model_type` | `stage_context` | `source_record_id` | `use_case_group` | Purpose |
|---|---|---|---|---|---|---|---|---|
| `RAI-FX-0001` | Churn Propensity Scoring | `bu-cm` (`fx-spoc-cm`) | false | classic-ML | pre-launch | `AIR-FX-2291` | `customer-analytics` | **Non-vendor case.** Slots 3 and 4 N/A by the non-vendor default (W1-04) with the default reason text; every other slot attached; slot 9 holds a PNG. The W1-INT journey case |
| `RAI-FX-0002` | Retail Store Assistant | `bu-rpc` (`fx-dual-coe-spoc-rpc`) | true | LLM | pre-launch | `Unknown` | `customer-service` | **Vendor case.** All nine slots attached including DPA and SOW; `checklist_template_version` `v2.0` (so the v1.0 bands never apply, A08 later); slot 9 holds the **Thai-named file** |
| `RAI-FX-0003` | Field Technician Dispatch Optimiser | `bu-cm` (`fx-spoc-cm`) | false | classic-ML | pre-build | `AIR-FX-2304` | `field-operations` | **Missing slot.** Slot 7 (security assessment) **missing**; slot 8 **not yet**; 3 and 4 N/A by default; the rest attached. Submitted by `fx-spoc-cm` in W1-INT's SPOC test; submit succeeds and the missing slot raises a finding (A02) |
| `RAI-FX-0004` | ผู้ช่วยตอบคำถามพนักงาน (Employee FAQ Assistant) | `bu-rpc` (`fx-dual-coe-spoc-rpc`) | true | LLM | idea | `Unknown` | `customer-service` | **N/A with reasons.** Slot 4 (SOW) N/A with reason "Vendor engaged under synthetic master agreement MSA-FX-0042; no separate statement of work"; slot 9 N/A with reason "No supporting documents beyond the eight gated artefacts"; slot 8 **not yet** (idea stage); slots 1, 2, 3, 5, 6, 7 attached; Thai `use_case_name` exercises W3-01 search and W3-03 subjects |

The four purposes required by the W0 contract (non-vendor, vendor, missing slot, N/A reasons) map one to one; the explicit N/A on `RAI-FX-0004` slot 4 is distinct from the default N/A on `RAI-FX-0001` slots 3 and 4 so that W1-04 can prove the default only fires when `vendor_involved` is false.

### 8.4 Documents (owned by W1-09)

Every kind in the section 2 table appears at least once. Filenames are the `filename` metadata; the object key is the content hash. Content of every document: the sentinel, the fixture ID, the case ID, the slot number and name, one Thai line ("เอกสารสังเคราะห์สำหรับการทดสอบ ไม่ใช่เอกสารจริง"), and the sentence "Generated by rai-web/fixtures. Not a real document. Contains no real data." Nothing else; document-quality defects (a BRD "with no metric") are not encoded in the bytes in slice 1 but scripted by the W1-10 QC substitute against the fixture artifact ID.

| Fixture ID | Case | Slot | Filename | Kind | Size class |
|---|---|---|---|---|---|
| `fx-doc-0001-01` | 0001 | 1 Risk screening | `RiskScreening_ChurnScoring.pdf` | PDF | small (< 10 KiB) |
| `fx-doc-0001-02` | 0001 | 2 Privacy checklist | `PrivacyChecklist_v1.0.xlsx` | XLSX | small |
| `fx-doc-0001-05` | 0001 | 5 BRD | `BRD_ChurnScoring_v1.0.docx` | DOCX | small |
| `fx-doc-0001-06` | 0001 | 6 AI architecture | `Architecture_Overview.pdf` | PDF | small |
| `fx-doc-0001-07` | 0001 | 7 Security assessment | `SecurityAssessment_signed.pdf` | PDF | small |
| `fx-doc-0001-08` | 0001 | 8 RAI deployment checklist | `DeploymentChecklist_v1.0.xlsx` | XLSX | small |
| `fx-doc-0001-09` | 0001 | 9 Other supporting | `DataFlow_Diagram.png` | PNG 64 × 64 | small |
| `fx-doc-0002-01` | 0002 | 1 | `RiskScreening_StoreAssistant.pdf` | PDF | small |
| `fx-doc-0002-02` | 0002 | 2 | `PrivacyChecklist_v1.1.xlsx` | XLSX | small |
| `fx-doc-0002-03` | 0002 | 3 DPA | `DPA_PartnerVendor_signed.pdf` | PDF | **medium** (≈ 2 MiB of generated filler so the transfer path is exercised above one TCP window) |
| `fx-doc-0002-04` | 0002 | 4 SOW | `SOW_PartnerVendor_2026.pdf` | PDF | small |
| `fx-doc-0002-05` | 0002 | 5 | `BRD_StoreAssistant_v2.0.docx` | DOCX | small |
| `fx-doc-0002-06` | 0002 | 6 | `Architecture_StoreAssistant.pdf` | PDF | small |
| `fx-doc-0002-07` | 0002 | 7 | `SecurityAssessment_StoreAssistant.pdf` | PDF | small |
| `fx-doc-0002-08` | 0002 | 8 | `DeploymentChecklist_v2.0.xlsx` | XLSX | small |
| `fx-doc-0002-09` | 0002 | 9 | `เอกสารประกอบ_ผู้ให้บริการ_2569.pdf` | PDF | small; **the Thai-named file** (NFC; 34 code points; 82 bytes UTF-8) |
| `fx-doc-0003-01` | 0003 | 1 | `RiskScreening_DispatchOptimiser.pdf` | PDF | small |
| `fx-doc-0003-02` | 0003 | 2 | `PrivacyChecklist_Dispatch.xlsx` | XLSX | small |
| `fx-doc-0003-05` | 0003 | 5 | `BRD_DispatchOptimiser_v0.9.docx` | DOCX | small |
| `fx-doc-0003-06` | 0003 | 6 | `Architecture_Dispatch.pdf` | PDF | small |
| `fx-doc-0003-09` | 0003 | 9 | `Whiteboard_Photo.jpg` | JPEG 16 × 16 baseline | small |
| `fx-doc-0004-01` | 0004 | 1 | `RiskScreening_FAQAssistant.pdf` | PDF | small |
| `fx-doc-0004-02` | 0004 | 2 | `PrivacyChecklist_FAQAssistant.xlsx` | XLSX | small |
| `fx-doc-0004-03` | 0004 | 3 | `DPA_FAQVendor_draft.pdf` | PDF | small |
| `fx-doc-0004-05` | 0004 | 5 | `BRD_FAQAssistant_idea.docx` | DOCX | small |
| `fx-doc-0004-06` | 0004 | 6 | `Architecture_FAQAssistant_sketch.png` | PNG 64 × 64 | small |
| `fx-doc-0004-07` | 0004 | 7 | `SecurityAssessment_FAQAssistant_pre.pdf` | PDF | small |

Slot dispositions not listed above are N/A with reason (0001: 3, 4 default; 0004: 4, 9 explicit), not yet (0003: 8; 0004: 8) or missing (0003: 7), exactly as section 8.3 states. The correction documents the W2 send-back journey attaches (for example `BRD_ChurnScoring_v1.1.docx`) are generated by the same generator under IDs `fx-doc-0001-05b` and so on and listed in the manifest; W2-10's contract PR adds their rows here.

### 8.5 Generator (owned by W1-09; no dependencies beyond Node)

`npm run fixtures:generate` (name proposed to W0-02) runs a TypeScript script that reads `manifest.json` and writes the documents to the git-ignored fixtures output directory, printing the manifest SHA-256 and the fixture set ID. Built with Node built-ins only:

- **PDF**: a hand-written single-page PDF (header `%PDF-1.4`, catalog, pages, one page, one uncompressed content stream with Helvetica text, the Thai line embedded as UTF-8 bytes in a `%` comment line and in the Info dictionary `/Subject` string (UTF-16BE with BOM) so the bytes are present without a Thai font, xref table, `%%EOF`); rendering Thai glyphs is not a fixture goal. The medium file appends a comment stream of deterministic filler. No `/JavaScript`, `/Launch`, `/EmbeddedFile` tokens, by construction.
- **DOCX / XLSX**: a minimal OOXML package written by a 60-line stored-method ZIP writer (CRC-32 from `node:zlib` `crc32()`, available since Node 22), fixed DOS timestamps, entries `[Content_Types].xml`, `_rels/.rels`, `word/document.xml` (or `xl/workbook.xml`, `xl/worksheets/sheet1.xml`, `xl/_rels/workbook.xml.rels`) with the sentinel text inline so it is greppable in the uncompressed bytes.
- **PNG**: 64 × 64 RGB, one level-0 (stored) zlib `IDAT`, a `tEXt` chunk `Comment=RAI-DESK-SYNTHETIC-FIXTURE <id>`, CRCs computed in the script.
- **JPEG**: a fixed 16 × 16 baseline JPEG byte array (SOI, `COM` segment with the sentinel and ID, DQT, SOF0, DHT, SOS, scan, EOI) with only the `COM` payload varying per fixture.

A `node:test` suite in the fixtures package asserts: each generated file's SHA-256 equals the manifest; each file passes the section 2 sniff for its declared kind; each contains the sentinel; the Thai filename is NFC and unchanged after a round trip through the section 6 `Content-Disposition` encoding; no file in the fixtures source directory is binary; no committed file exceeds 64 KiB.

### 8.6 Hostile set (owned by W1-03 tests; generated at test time, never committed)

Each is built in a temp directory by the same helpers and must be rejected with the stated reason. This is the unit-test contract for the sniff module and the W1-08 negative "unsafe upload" evidence.

| Name | Bytes | Declared name | Expected reason |
|---|---|---|---|
| PE stub | `MZ` + 4,094 zero bytes | `report.pdf` | `type_not_allowed` |
| ELF stub | `7F 45 4C 46` + zeros | `report.docx` | `type_not_allowed` |
| Shebang script | `#!/bin/sh\nexit 0\n` | `notes.pdf` | `type_not_allowed` |
| HTML | `<html><script>1</script></html>` | `page.pdf` | `type_not_allowed` |
| Renamed PNG | valid fixture PNG bytes | `diagram.pdf` | `type_mismatch` |
| Renamed PDF | valid fixture PDF bytes | `scan.png` | `type_mismatch` |
| XLSX as DOCX | valid fixture XLSX bytes | `sheet.docx` | `type_mismatch` |
| Plain ZIP | ZIP with one `hello.txt` entry, no `[Content_Types].xml` | `pack.docx` | `container_invalid` |
| Polyglot | valid fixture JPEG bytes + valid ZIP appended | `photo.jpg` | `container_invalid` (JPEG rule: trailing bytes after `FF D9`) |
| Polyglot 2 | valid fixture DOCX bytes + 16 trailing bytes | `brd.docx` | `container_invalid` (EOCD not at end) |
| Macro package | fixture DOCX plus entry `word/vbaProject.bin` | `brd.docx` | `macro_enabled` |
| Macro extension | fixture DOCX bytes | `brd.docm` | `extension_not_allowed` |
| Nested archive | fixture DOCX plus entry `word/embeddings/payload.zip` | `brd.docx` | `nested_archive` |
| Embedded executable | fixture DOCX plus entry `word/embeddings/tool.exe` | `brd.docx` | `nested_archive` |
| Encrypted entry | fixture DOCX with bit 0 set on `word/document.xml` | `brd.docx` | `encrypted_entry` |
| Traversal entry | fixture DOCX plus entry `../../etc/passwd` | `brd.docx` | `container_invalid` |
| Declared bomb | fixture DOCX plus a stored entry declaring 1 GiB uncompressed | `brd.docx` | `container_invalid` |
| ZIP64 | fixture DOCX plus a ZIP64 EOCD locator | `brd.docx` | `container_invalid` |
| PDF with JS | fixture PDF with `/OpenAction << /S /JavaScript /JS (1) >>` | `form.pdf` | `active_content` |
| PDF with embedded file | fixture PDF with `/EmbeddedFile` | `form.pdf` | `active_content` |
| PDF without EOF | fixture PDF truncated before `%%EOF` | `scan.pdf` | `container_invalid` |
| PNG bomb | valid signature, `IHDR` 100,000 × 100,000 | `big.png` | `image_too_large` |
| PNG trailing | fixture PNG + 8 bytes after `IEND` | `diagram.png` | `container_invalid` |
| JPEG bomb | fixture JPEG with `SOF0` rewritten to 65,535 × 65,535 | `big.jpg` | `image_too_large` |
| Empty | 0 bytes | `empty.pdf` | `empty_file` |
| Boundary accept | 26,214,400 bytes of valid PDF (fixture PDF + filler) | `max.pdf` | accepted |
| Boundary reject | 26,214,401 bytes | `max.pdf` | `too_large` |
| Pack total | four 40 MiB valid PDFs into one version | `p1.pdf` … `p4.pdf` | fourth rejected `pack_total_exceeded` (160 > 150) |
| Bad filename | fixture PDF | `../escape.pdf`, `a\u0000b.pdf`, 201 code points, `.pdf` | `filename_invalid` |
| Double extension | fixture PDF | `report.pdf.exe` | `extension_not_allowed` |
| Legacy Office | `D0 CF 11 E0 A1 B1 1A E1` + zeros | `old.doc` | `extension_not_allowed` (and `type_not_allowed` if renamed `.docx`) |

No EICAR test string and no real malware sample is ever used; hostile files are structural stubs that no scanner quarantines.

### 8.7 Loading and reset

`npm run fixtures:load` (W1-09; name proposed to W0-02) runs `fixtures:generate` if the output is absent, then inside one transaction inserts: identities into the fixture identity provider's table (W1-00), the configuration seed (`checklist_template_version` list, SLA values and calendar, `use_case_group` list, `operator_recipients` = the single address above; W1-00), the four cases, one draft version each, slot dispositions and reasons, the objects into `<BLOB_ROOT>/objects/` through the same blob interface uploads use, and the artifact rows. It prints the fixture set ID and manifest hash. `npm run db:reset` (W0-02) drops and recreates the schema and empties `<BLOB_ROOT>`; `fixtures:load --reset` calls it first. Both refuse outside `development`/`test`.

The W1-13 UI substitute reads the same manifest to serve shapes; it never loads the loader or touches a database.

## 9. Acceptance items for Ta at W0-09

Ta accepts, for synthetic data only:

1. the allowed list: PDF, DOCX, XLSX, PNG, JPEG (section 2), with archives, executables, macro-enabled and legacy Office, browser-active text and all other types refused;
2. the limits in section 3 (25 MiB per file, 150 MiB per pack version, 40 MP images, ZIP bounds, 200-code-point filenames);
3. the PDF active-content scan (2.1) as a slice-1 rule, accepting that it can reject a benign PDF with an attachment;
4. that no malware scanning exists in slice 1 (2.4);
5. the fixture identities, business-unit labels, cases and the operator address in section 8;
6. that IT/Security was not named by W0 exit, so this acceptance is Ta's alone and is re-examined at D08.

## 10. Open items and D08 revisit list

- [ ] **D08** (DPO + IT/Security, before real data): per-file and per-pack limits for real packs; whether embedded files in PDFs are ever legitimate; OLE `.bin` embeddings in OOXML; a host malware scanner or parsing worker; retention and per-actor counting of rejected uploads; blob deletion and key custody (W0-04 options); whether a library detector replaces the hand-written sniff.
- [ ] **D10**: `<BLOB_ROOT>` location, permissions and backup on the True host.
- [ ] **W0-02**: confirm the env names (`UPLOAD_MAX_FILE_BYTES`, `UPLOAD_MAX_PACK_BYTES`, `UPLOAD_MAX_IMAGE_PIXELS`, `BLOB_ROOT`), the command names (`fixtures:generate`, `fixtures:load`, `db:reset`), the fixtures path, `@fastify/multipart` in the pinned list, and the shared `UnsafeUploadError` field names.
- [ ] **W0-05**: whether "BU SPOC on a case" is scope or action for the dual-role identity; 403 versus 404 for out-of-scope artifact references.
- [ ] **W0-06**: the error for an upload aimed at a submitted version (409 `stale_version` versus 422 `invalid_input`).
- [ ] **W0-09**: request time budget and in-flight uploads per session.
- [ ] **W1-04**: slot 9 cardinality; the per-pack total in section 3 is defined independently of it.
- [ ] **W2-10**: rows for the correction documents in section 8.4.

## References

- [W0 technical contract](../delivery/w0-technical-contract.md#w0-08--upload-safety-policy-and-fixtures) — W0-08 text this document implements; W0-02 to W0-07, W0-09, W0-10 sections linked above
- [ADR-0003](../../adr/0003-stack-and-deployment-boundary.md) — D04 stack; `unsafe_upload` 422; content-hash blob store; proposed `rai-web/*` layout for W0-02
- [Decision register](../product/decisions.md) — D03 (synthetic only), D05 (dual-role rule), D06 (`operator_recipients`), D11 (`use_case_group`, `stage_context`), D12 (locale keys), W0-04 fields (`vendor_involved`, `model_type`); D08 open
- [Source spec](../product/source-spec.md) — "Pack and lanes": nine slots, four dispositions, non-vendor N/A default (frozen; hash in [sources](../sources.md))
- [Data contract](../product/data-contract.md) — artifact slot, audit event, "files live within the application's controlled storage, never Git"
- [Workflow](../product/workflow.md) — draft, submit, successor version
- [Threat model](../security/threat-model.md) — rows mapped in section 7
- [Acceptance](../acceptance.md) — A01, A02, A07, A11; cross-cutting negative cases "unauthorized artifact download, malicious documents"
- [Slice 1 work breakdown](../delivery/slice-1-work-breakdown.md) — W1-00, W1-03, W1-04, W1-09 to W1-13, W1-INT, W1-08
- [Design-to-build map](../delivery/design-to-build-map.md) — "canned attachments" become real uploads (W1-03); "scenario selector and reset" become fixtures loaded in test and dev only
- [Team and roles](../delivery/team-and-roles.md) — IT/Security "to be named"; agents may generate synthetic fixtures and never use real data
