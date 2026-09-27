# Review: locators carry no document text (W4-16, #202)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W4b plan](../../docs/engineering/implementation-plan-w4b.md) section 15 row W4-16 and section 9 "Evidence locators". Decision implemented: register row "W4b delegated rulings (provisional)" decision 21 (b), under "Ta's delegation (2026-09-27)". D07-D10 stay open. No migration, no rule, no model, no network call; synthetic data only.

## Change

- **Shared contract** (`shared/src/qc/types.ts`): `EvidenceLocator` `cell` is `{ kind, sheetIndex?, cell? }` and `section` is `{ kind, index? }`; `heading` and `sheet` are gone. `CELL_REFERENCE_PATTERN` (`^[A-Z]{1,3}[1-9][0-9]{0,6}$`) is exported here.
- **Runner schema** (`shared/src/qc/validate.ts` `EvidenceLocatorSchema`): `index`/`sheetIndex` integers of at least 1, `cell` by the pattern, every variant closed, so `heading`/`sheet` fail step 4 (`unknown_field`) and a runner result carrying one is `runner_error`.
- **Read** (`shared/src/schemas/review.ts`, `server/src/qc/repository.ts` `locatorView`): the read schema has the same optional fields; `locatorView` serves a stored locator with a legacy `heading` or `sheet` field as its bare kind (even when an ordinal sits beside it), copies a well-formed ordinal and reference otherwise, and drops a malformed one.
- **Extraction wire** (`server/src/qc/extraction/{port,protocol}.ts`): `Locator = EvidenceLocator` (plan 4.2; the interim `OrdinalLocator` union is removed); `WireLocatorSchema` drops the `heading` and `sheet` variants, so such a worker reply is `crash`. The caps are still counted first. The worker-side `sink.ts` comment is updated; its code is unchanged.
- **Substitute scripts**: `fx-case-vendor.json` → `{ kind: 'section', index: 4 }`, `fx-case-nonvendor.json` → `{ kind: 'section', index: 3 }`.
- **UI** (`web/src/screens/case/{view-model.ts,finding-list.tsx}`): `evidenceLabel(locator)` gives the ordinal label (`review.evidence.ordinal.{page,section,cell,sheet,cell_ref}`, th and en, sorted), falling back to the kind label for a bare kind, `text_range` and `absent`; `evidenceLocations` now dedups by slot and label, so two sections of one slot are two entries.
- **Documents**: dated W4-16 amendments in W0-07 3.3 (`qc-boundary-and-mail-sink.md`) and W0-02 section 7 (`implementation-plan-w1-w3.md`).
- **Tests**: new `server/src/qc/evidence-view.test.ts` (4 cases: ordinals served; legacy heading/sheet rows served as the kind only and no text in the body; malformed ordinals dropped; served locators conform to the read schema); new cases in `shared/src/qc/validate.test.ts`, `fixtures/src/substitutes/qc/scripts.test.ts`, `server/src/qc/extraction/protocol.test.ts` and `web/src/screens/case/view-model.test.ts`.

## Deviations

- **Extraction wire and port touched** (not in the row's path list). Removing `heading`/`sheet` from the shared `EvidenceLocator` makes the wire's static type (which still had them) unassignable to `Segment.locator`, so `npm run typecheck` fails unless the wire changes too. Chosen: drop the text variants from the wire (the DOCX, XLSX and PDF parsers never emit them) and alias `Locator` to `EvidenceLocator` as plan 4.2 states. This keeps the text shapes out at the first untrusted boundary as well as at step 4.
- **Fields optional on the runner side too.** The plan writes the shape as `section: { kind, index?: number }` and `cell: { kind, sheetIndex?: number, cell?: string }` without separating the runner and read schemas, so both accept the bare kind. The wire, whose parsers always know the ordinals, keeps them required (as W4-05c had it).
- **Legacy row with an ordinal and a text field** is served as the bare kind, not with the ordinal: a row that holds document text contributes no field, which is the simplest rule that can never serve text.
- **UI wording.** Plan section 10 (W4-12b's) phrases the line as "slot 1, page 3"; this ticket keeps the existing W4-12 template `{place} ({kind})` and substitutes the ordinal label for the kind, so it reads "slot 1 (page 3)". W4-12b owns the final wording. The Thai section label is "หัวข้อที่ {index}" to match the existing kind label "หัวข้อ".
- **Changed expectations in existing tests** (the plan changes the behaviour):
  - `view-model.test.ts` (named in the row): the `heading` literals move to `{ kind: 'section', index: 4 }`; the dedup case now uses two identical ordinals (two different ordinals are two locations by design), and the assertion maps to `{ slot, kind }` because entries gain `label`.
  - `tests/integration/w4-12-qc-runs.test.ts`: the served ACC-METRIC-CITED locator is `{ kind: 'section', index: 4 }` (the migrated script).
  - `tests/browser/w4-12-qc-log.spec.ts`: the evidence line reads the ordinals ("section 4", "page 3") instead of the kind labels.
  - `protocol.test.ts`: "locator strings count toward the text cap" uses an ordinal `cell` for the at-cap case (plus a new over-cap case); in "a locator string over the per-field bound", the at-bound `heading` reply is now `crash` instead of ok. Every cap assertion is kept.
  - `validate.test.ts` new case: for a malformed ordinal the violation may be `schema_violation` or `unknown_field` (TypeBox reports the other union members' closed shapes); the test asserts one of the two, and `unknown_field` exactly for `heading`/`sheet`.
- **Lane environment**: `RAI_PG_TOOLS=docker-compose:rai-qc-core` in the uncommitted `.env` (the example's `rai-dev` container does not exist for this lane); the first integration run failed only the 6 W7-01/W7-02 backup cases with `pg_tools_container_not_found`, and passed after the change.

## Checks

| Command (from `rai-web/` unless noted) | Result |
|---|---|
| RED: `node --import tsx --conditions=rai-source --test` on `validate.test.ts`, `evidence-view.test.ts`, `scripts.test.ts`, `protocol.test.ts`, `view-model.test.ts` before the change | failed for the right reasons: `CELL_REFERENCE_PATTERN` not exported; 9 failing cases (`evidenceView` served the heading / dropped ordinals, text locators accepted by the wire and the scripts, labels missing) |
| `npm ci` | exit 0 |
| `npm run lint` | exit 0 (eslint, prettier check, check-css) |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | 1040/1040 |
| `npm run test:integration` | 449/449, 0 skipped (after the `RAI_PG_TOOLS` fix above) |
| `npm run build && npm run check:substitute-absent` | exit 0; 923 files scanned, 0 with the marker |
| `npm run test:browser:server` | 205 passed |
| `npm run test:browser:substitute` | 48 passed |
| `node scripts/check-links.mjs` (root) | 465 Markdown files, 1307 links, 0 broken (rerun after the records were added) |
| `git diff --check` (root) | clean |

## Verdicts

Pending: two independent reviewer verdicts on the exact head (D03 ticket flow).
