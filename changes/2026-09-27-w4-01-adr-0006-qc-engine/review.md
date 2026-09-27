# Review: ADR-0006, QC engine and extraction, provisional (W4-01, #200)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: the W4-01 row of the [W4b plan](../../docs/engineering/implementation-plan-w4b.md) section 15 and the sections it names (decisions 5, 7, 8, 12-16, 14b and 27; sections 3.4, 4, 5, 11, 12 and 19). The plan wins over issue #200. Decisions implemented: register rows "Ta's delegation (2026-09-27)" and "W4b delegated rulings (provisional)". D08 and D09 stay open; their answers appear only as labelled working assumptions. Synthetic data only; no code, dependency, provider or network call.

## Change

- **`adr/0006-qc-engine-and-extraction.md`** (new), in the ADR template shape. Status **Provisional**, not accepted; Ta's and the tech lead's acceptance moves to the W4b exit review (W4-14), and W4-05 and W4-07 may merge on it. For each of the engine (decision 7, PR), parsers (8, PR), parser isolation (5, WA-D08), run parts (27, PR) and evaluation method (12-16 and 14b, WA-D09) it lists the options, the adopted one, and what was not chosen and why. A sixth table records the D08 model data-handling assumptions (decisions 2-4, 6) the engine depends on. It names **no model provider and no hosting** (`QC_MODEL` is `disabled` or `local-fake` only), records that no dependency is added, states the authority limits (the model proposes claim candidates only; deterministic rules decide), the consequences, risks (held-out thresholds at 1.00; the remedy is a new held-out version, never a lowered threshold), open items with owners and gates, and stop conditions.
- **`adr/README.md`**: the 0006 row links the ADR, reads "Provisional", and the closing paragraph says 0006 is written but provisional and names no provider or hosting.
- **`docs/security/threat-model.md`**: three dated rows (2026-09-27, W4-01): parser exploit, hang or memory blow-up (worker isolation and fail-closed limits); document text or hostile instructions reaching a model (candidate-only model, data block, output validation, probes); case data sent to an external provider (no provider, no key; D08 open).
- **`docs/engineering/upload-safety-and-fixtures.md`** section 10: a dated W4-01 note under the list. The "parsing worker" part of the D08 item is settled for synthetic data only by ADR-0006 (a working assumption, not a D08 decision) and implemented by W4-05b-d; the upload sniff and path are unchanged; every real-data item of that bullet stays open, including stronger isolation for real data.
- **`docs/engineering/implementation-plan-w1-w3.md`** (W0-02) section 4: a dated W4-01 note after 4.3 that W4b adds no dependency (`node:zlib`, `node:buffer`, `node:child_process`; `pdfjs-dist`, an OOXML library and `pdftotext` weighed and not chosen); 4.1 and 4.2 unchanged.
- **Records**: board CLAIM on `docs/board/lane-lead-integration.md`; this change frame; DEVLOG top entry; CHANGELOG line under 2026-09-27.

## Deviations

- **TDD for a documentation-only ticket.** No behaviour changes, so no unit or integration test is added. The failing check written first was the link checker: the 0006 row of `adr/README.md` was linked to `0006-qc-engine-and-extraction.md` before the file existed, and `node scripts/check-links.mjs` failed on exactly that link (below); it passes after the ADR was written. The full gate was then run to show nothing regressed.
- **ADR title.** The README reserved row was titled "QC boundary and model data handling"; the plan names the file `0006-qc-engine-and-extraction.md` and the issue "QC engine and extraction". The row and the ADR now use "QC engine and extraction"; the model data-handling working assumptions are still recorded inside it (section 6 of its options).
- **Upload safety note wording.** Plan section 19 says "parsing worker implemented locally". At W4-01 the worker is not yet written (W4-05b-d), so the note says the item is settled by ADR-0006 and implemented by W4-05b-d, rather than claiming an implementation that does not exist yet.
- **DEVLOG and CHANGELOG.** Plan section 19 assigns DEVLOG and CHANGELOG to W4-14; the ticket brief asks every ticket for a DEVLOG top entry and a CHANGELOG line, so both were added. W4-14 still writes the package entry.
- **W0-07 open item** ("model or extraction method behind `QcRunner` — ADR-0006 at W4 entry", section 10) is not edited: plan section 19 assigns no W0-07 note to W4-01, and the W0-07 amendments belong to W4-06a-d, W4-07a, W4-13b and W4-18.

## Commands and results

Worktree `/tmp/rai-w4-01-adr-0006-qc-engine`, Postgres project `rai-qc-content` on 55382, `rai-web/.env` from `.env.example` with the ports rewritten (8811/8812/8813/5192). One suite at a time, after `set -a; . ./.env; set +a`; logs under `/tmp/rai-w4-01-adr-0006-qc-engine-logs/`.

| Command (from `rai-web/` unless noted) | Result |
|---|---|
| RED: `node scripts/check-links.mjs` (repo root), README linked before the ADR existed | exit 1; `adr/README.md:12 → 0006-qc-engine-and-extraction.md (missing)`, 1 broken of 1062 |
| `npm ci` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | exit 0, 648/648 |
| `npm run test:integration` | exit 0, 374/374 |
| `npm run build && npm run check:substitute-absent` | exit 0; `scanned 675 files, 0 with the marker` |
| `npm run test:browser:server` | exit 0, 202 passed (9.3 min) |
| `npm run test:browser:substitute` | exit 0, 48 passed (35.0 s) |
| `node scripts/check-links.mjs` (repo root) | exit 0; 374 Markdown files, 0 broken (final run, with this file; the in-gate run failed only on the DEVLOG link to this then-unwritten review) |
| `git diff --check` (repo root) | exit 0 |

## Review verdicts

Pending: two independent reviewer verdicts on the exact PR head and green CI on that head (D03 ticket flow). ADR acceptance is Ta's and the tech lead's at W4-14.
