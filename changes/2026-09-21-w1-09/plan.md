# Plan: W1-09 — synthetic case and document fixture set

2026-09-21. Ticket W1-09 (issue #24), lane C, Agent-eligible. Branch `codex/w1-09-synthetic-fixtures`, worktree `/Users/tkhongsap/github/rai-wt/W1-09`, Postgres `rai-w1-09` on port 54329. Recorded before code.

## Intent

Give every later ticket the W0-08 section 8 fixture set: five synthetic cases (non-vendor, vendor, missing slot, N/A with reasons, D05 dual-role), their 33 documents including the Thai-named file, generated inside the repository from Node built-ins, loaded into an empty database by one command, identified by `fixture set slice1-synthetic@1 <sha256[0:12]>`, and provably free of real names, addresses, identifiers and source-system content.

## Spec (what is implemented, from where)

- Cases: [W0-08 section 8.3](../../docs/engineering/upload-safety-and-fixtures.md#83-cases-owned-by-w1-09) verbatim (ids, registry ids `RAI-2000-0001..0005`, BU, SPOC, `vendor_involved`, model type, stage, `source_record_id`, `use_case_group`, template version, slot dispositions).
- Documents: [W0-08 section 8.4](../../docs/engineering/upload-safety-and-fixtures.md#84-documents-owned-by-w1-09) verbatim (33 rows, filenames, kinds, size classes; content = sentinel, fixture id, case id, slot, Thai line, provenance sentence, nothing else).
- Generator: [W0-08 section 8.5](../../docs/engineering/upload-safety-and-fixtures.md#85-generator-owned-by-w1-09-no-dependencies-beyond-node) (hand-written PDF, stored-method OOXML, 64×64 RGB PNG with a stored IDAT, fixed 16×16 baseline JPEG; deterministic bytes; per-document SHA-256 in the manifest; the fixtures-package `node:test` suite it lists).
- Loading: [W0-08 section 8.7](../../docs/engineering/upload-safety-and-fixtures.md#87-loading-and-reset) and 8.1 rules 4-6 (one transaction; cases, one draft each, slot rows, objects under `BLOB_DIR/sha256/`, artifact rows, `fixture_set` row; never a submitted version, decision, finding or disposition; refuses outside `development`/`test`, outside `local-google`/`fixture`, and on a non-empty database unless `--reset`).
- Identity convention: [W0-02 section 8.3](../../docs/engineering/implementation-plan-w1-w3.md#83-fixture-identity-convention); commands and paths: W0-02 sections 1 and 3.3.
- Identities and the operator recipient: W1-00's `fixtures/src/data/users.ts` and `server/src/configuration/seed.ts`, referenced, not redefined.

## Plan

1. `fixtures/src/data/cases/index.ts`, `fixtures/src/data/documents/index.ts`: the two tables as frozen typed constants; deterministic UUIDs derived from the fixture ids so W1-10 and W1-13 can key on them; each case states owner, BU SPOC, journey submitter and the identity evidence records cite.
2. `fixtures/src/generate/` (`pdf.ts`, `ooxml.ts`, `png.ts`, `jpeg.ts`, `blob-layout.ts`) and `fixtures/src/generate.ts`: `npm run fixtures:generate` writes `rai-web/.local/fixtures/<fixtureId>/<filename>` and prints the set identity; `--write-manifest` refreshes `data/manifest.json`.
3. `fixtures/src/data/manifest.json`: `{ name, version, sha256, documents }`; `fixtures/src/manifest.ts` computes the set hash over the sorted data files and the document digests.
4. `fixtures/src/load.ts`: extend W1-00's loader (cases, drafts, slots, blobs, artifacts, `fixture_set` row, `--reset`, identity-mode refusal). New migration `server/drizzle/0002_w1_09_fixture_set.sql` and schema `server/src/db/schema/fixture-set.ts` for the row W0-08 8.7 assigns to this ticket; `tests/support/db.ts` truncates it.
5. Tests first: `fixtures/src/generate.test.ts` (hash = manifest, structural check per W0-08 section 2, sentinel, Thai filename NFC round trip through `filename*`, no binary or > 64 KiB source file), `fixtures/src/data/provenance.test.ts` (denylist grep), `fixtures/src/data/cases.test.ts` (tables match W0-08 8.3/8.4), `tests/integration/w1-09-fixtures-load.test.ts` (one command loads a clean database; rows, blobs, refusals, no fabricated transitions).
6. Docs: `fixtures/src/data/README.md` (provenance statement, identity per fixture, how to cite), `TESTING.md` (fixture set string), this folder's `review.md` with the exact commands and output.

Not decided here: D07-D10; the sniff module (W1-03's; the test carries a test-local structural check); the `BlobStore` interface (W1-03a's; the loader writes the W0-04 layout directly and W1-03a swaps the call).
