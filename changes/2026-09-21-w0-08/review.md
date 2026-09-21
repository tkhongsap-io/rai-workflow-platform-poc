# Review: W0-08 — upload safety policy and synthetic fixture strategy

2026-09-21. Ticket W0-08 (issue #13), branch `codex/w0-08-upload-safety-fixtures`, worktree `/Users/tkhongsap/github/rai-wt/W0-08`. Implementer self-review; independent reviewer agents run before merge per the D03 amendment. Proves A01 (direct-file negative) and the threat-model rows on malicious or oversized uploads and unauthorized download.

## What landed

- `docs/engineering/upload-safety-and-fixtures.md` (new): the W0-08 specification, concrete for ADR-0003 (D04) and stack-neutral in intent.
  - Allowed types PDF, DOCX, XLSX, PNG, JPEG with the magic bytes and the full-byte structural check for each; deny by default; extension and bytes must agree (the browser `Content-Type` is never consulted). PDF active-content byte scan, ZIP central-directory rules (polyglot, ZIP64, entry caps, methods, encryption, path traversal, `vbaProject.bin`, nested archives and executables, DOCX/XLSX kind detection), PNG `IHDR`/`IEND` and JPEG `SOF`/`EOI` rules. A named list of rejected classes (archives, executables and scripts, macro-enabled and legacy Office, browser-active text, other media). What is deliberately not checked (no malware scan, no parsing) stated for D08.
  - Limits proposed for Ta at W0-09: 25 MiB per file, 150 MiB per pack version, one file per request, 40 MP images, ZIP bounds, 200-code-point NFC filenames, 120 s request budget; defaults that cannot be widened by local configuration.
  - Order of checks 1-13 with the ADR-0003 code for each failure; the multipart 413 mapped to 422 `unsafe_upload`; per-pack total checked inside the transaction with the version row locked; artifact row and audit event in one transaction; QC trigger after commit.
  - Safe error: `UnsafeUploadReason` union (13 reasons), response shape aligned to the ADR-0003 `code` + locale key + correlation ID rule, and the initial Thai-default/English locale strings (D12). Rejections write a redacted W0-10 log event and no audit event.
  - Storage and download safety: SHA-256 keyed objects with no extension outside every served directory, atomic staging rename, dedup, no overwrite or delete in slice 1, one authorized download route with `attachment` + RFC 8187 `filename*` (Thai round trip), `nosniff`, `CSP: sandbox`, `no-store`.
  - Threat-model mapping table (threat → control → proving ticket).
  - Fixture strategy: generated inside the repo from a manifest, no committed binaries, deterministic bytes with a `RAI-DESK-SYNTHETIC-FIXTURE` sentinel in every document, fixtures never fake a transition, test/dev only, fixture identity convention `rai-fx-1` + manifest hash. Seven identities (six single-role users plus the W0-03 dual-role identity `fx-dual-coe-spoc-rpc`, AI/COE reviewer and SPOC of `bu-rpc`), all at the reserved domain `rai-desk.example`; the single operator recipient `operator-digest@rai-desk.example` for the local mail sink only. Four cases: non-vendor (`RAI-FX-0001`), vendor (`RAI-FX-0002`, all nine slots, Thai-named file `เอกสารประกอบ_ผู้ให้บริการ_2569.pdf`), missing slot (`RAI-FX-0003`, slot 7 missing, slot 8 not yet), N/A with reasons (`RAI-FX-0004`, explicit N/A on slots 4 and 9, Thai `use_case_name`). 27 documents covering every allowed kind; the generator built from Node built-ins only; a 30-row hostile set generated at test time (no EICAR, no real malware); loader and reset commands proposed to W0-02.
  - Acceptance items for Ta at W0-09 and the D08 revisit list; open items assigned to W0-02, W0-05, W0-06, W0-09, W1-04, W2-10; cross-links to every consuming ticket and to the W0-02 to W0-07 and W0-10 contract sections.

Not edited, on purpose: `docs/product/decisions.md` (D08 stays open; agents never record decisions), `docs/product/source-spec.md` (frozen), `docs/architecture/README.md` and `TESTING.md` (W0-02 only), `adr/README.md` (no ADR change; W0-08 produces an engineering spec, not an ADR), the ticket row status (issue #13 tracks it), DEVLOG/CHANGELOG/board (appended by the merge step). The parallel W0-02 to W0-07 and W0-10 documents are linked through the W0 contract's section anchors, not by guessed file names; where this spec proposes a name one of them owns (env variables, command names, shared error field names), the owning spec wins and this document is corrected at W0-09, as its header states.

## Checks

Shell: `export PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH` (node v24.21.0). No Postgres needed: document ticket.

| Command | Result |
|---|---|
| `node --test tests/*.test.mjs` | 22 pass, 0 fail, 0 skipped |
| `git diff --check` | clean |
| `shasum -a 256 docs/product/source-spec.md` | `92c4f7123058b8fec3c2ba7abdf10538fad034778624b0675975b39de440b354`, matches docs/sources.md |
| Relative-link and anchor audit over the new spec (scratch script) | 28 links, 0 broken |
| `node -e` NFC/length check on the Thai fixture filename | NFC true, 34 code points, 82 bytes UTF-8 (inside the 200-code-point rule) |

No product suite exists yet (the application skeleton arrives with W1-00 under the W0-02 layout), so `npm test`, lint, typecheck and Playwright do not apply to this ticket.

## Done-when check (W0 contract, W0-08 section and exit checklist)

- [x] Initial allowed types PDF, DOCX, XLSX, PNG, JPEG; per-file and per-pack limits set; archives and executables rejected; proposed for Ta's acceptance at W0-09, D08 revisits before real data.
- [x] Unsafe bytes rejected with a safe error; the check is stated (type sniffing by magic and structure, never the extension alone; extension and bytes must agree).
- [x] Fixtures synthetic and generated inside the repo; one non-vendor case, one vendor case, one missing-slot case, one N/A-reasons case; no content copied from real cases or Life-OS evidence; one Thai-named file; one synthetic operator recipient address used only by the local mail sink; six synthetic users plus the dual-role identity.
- [x] Concrete for the D04 stack while the boundaries stay stack-neutral in intent; cross-linked to the other W0 specs and to the consuming ticket IDs.
- [x] D07-D10 untouched; frozen source spec unchanged; no application code, package manifest or workflow file created.

## Limitations

- IT/Security is not yet named, so the policy carries Ta's synthetic-data acceptance only; nothing here is a real-data limit.
- The PDF active-content scan is byte-level and cannot see inside compressed object streams; the document says so and names the compensating controls.
- Command names, env variable names and the fixtures path are proposals to W0-02, which owns them.
