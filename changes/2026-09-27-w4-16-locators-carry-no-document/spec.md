# Specification

Source: W4b plan section 15 row W4-16 and section 9 "Evidence locators" (decision 21). The plan wins over issue #202.

Done when:

1. **Shared contract.** `EvidenceLocator` (`shared/src/qc/types.ts`) is `page`, `text_range`, `cell: { kind, sheetIndex?: number, cell?: string }`, `section: { kind, index?: number }` and `absent`. No variant has a `heading` or `sheet` field. `CELL_REFERENCE_PATTERN` (`^[A-Z]{1,3}[1-9][0-9]{0,6}$`) is exported from the shared types.
2. **Runner schema.** `EvidenceLocatorSchema` in `shared/src/qc/validate.ts` accepts only the new shape: `index` and `sheetIndex` are integers of at least 1, `cell` matches the pattern, and every variant refuses unknown keys, so `{ kind: 'section', heading }` and `{ kind: 'cell', sheet, cell }` fail `validateQcFinding` (`evidence_invalid`). The bare kinds `{ kind: 'section' }` and `{ kind: 'cell' }` pass (the fields are optional in the plan's shape).
3. **Extraction wire.** `WireLocatorSchema` (`server/src/qc/extraction/protocol.ts`) no longer accepts the `heading` and `sheet` shapes: a worker reply carrying one is `crash`. The caps are still counted before the schema. `Locator` in `port.ts` is `EvidenceLocator` (plan 4.2).
4. **Read.** `locatorView` in `server/src/qc/repository.ts` serves `section` with `index` and `cell` with `sheetIndex`/`cell` when they are well formed; a stored locator with a legacy `heading` or `sheet` field is served as the bare kind; a malformed ordinal or a `cell` outside the pattern is dropped from the served locator. The read schema `EvidenceLocatorSchema` in `shared/src/schemas/review.ts` has the same shape (optional fields; W0-02 section 7).
5. **Substitute scripts.** `fx-case-vendor.json` and `fx-case-nonvendor.json` use `{ kind: 'section', index: n }`; `scripts.test.ts` asserts that no bundled locator carries `heading` or `sheet`, and that a script with a text locator is refused at construction (`evidence_locator_invalid`).
6. **UI.** The evidence line renders the ordinals: page number, section ordinal, sheet ordinal and cell reference, in th and en, from new keys under `review.evidence.*`; two entries that differ only by ordinal are both listed. A legacy bare kind still renders as the kind label.
7. **Documents.** Dated amendment notes on W0-07 3.3 (`qc-boundary-and-mail-sink.md`) and W0-02 section 7 (`implementation-plan-w1-w3.md`).
8. The plan's full gate (section 16) is green.
