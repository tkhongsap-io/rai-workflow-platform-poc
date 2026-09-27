# Specification

Source: the W4-01 row of the [W4b plan](../../docs/engineering/implementation-plan-w4b.md) section 15 and the sections it names: decisions 5, 7, 8, 12-16 (with 14b) and 27 (section 1), sections 3.4, 4, 5, 11 and 12, and section 19 (what this plan changes in other documents). The plan wins over issue #200.

Done when:

1. **`adr/0006-qc-engine-and-extraction.md`** exists, in the [ADR template](../../adr/TEMPLATE.md) shape, and:
   - is marked **Provisional** (made by the agent team under Ta's delegation of 2026-09-27), with acceptance by Ta and the tech lead moved to the W4b exit review (W4-14);
   - records, for each of the engine (decision 7), parsers (8), parser isolation (5), run parts (27) and evaluation method (12-16, 14b), the options weighed, what was adopted, **what was not chosen and why**;
   - labels decisions 5 and 12-16 as working assumptions for D08 and D09, which stay open, and 7, 8 and 27 as provisional rulings;
   - **names no model provider and no hosting**: `QC_MODEL` takes only `disabled` and `local-fake`, and adding a provider needs a D08 row and a new ticket;
   - records that no dependency is added (decision 8; W0-02 section 4);
   - states the authority limits (the model proposes claim candidates only; deterministic rules decide findings; nothing approves, waives or transitions) and the stop conditions.
2. **`adr/README.md`**: the 0006 row links the ADR and reads "Provisional".
3. **Threat model** (`docs/security/threat-model.md`): dated rows for parser isolation, model input, and no provider.
4. **Upload safety section 10** (`docs/engineering/upload-safety-and-fixtures.md`): a dated note that the parsing-worker item is decided locally by ADR-0006 (provisional) and implemented for synthetic data by W4-05b-d, and that the real-data items stay open under D08.
5. **W0-02 section 4** (`docs/engineering/implementation-plan-w1-w3.md`): a dated note that W4b adds no dependency.
6. Change frame, board CLAIM, DEVLOG top entry and CHANGELOG line.
7. The full plan section 16 gate is green.
