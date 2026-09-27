# Intent: ADR-0006, QC engine and extraction, provisional (W4-01, #200)

W4b makes QC read document contents. Before any extraction or model code merges, the choice of engine, the way documents are parsed and isolated, how one trigger splits into run parts, and how the result is evaluated need one architecture record that says what was chosen, what was not, and why. The [W4b plan](../../docs/engineering/implementation-plan-w4b.md) made those choices as provisional rulings (decisions 7, 8 and 27) and as working assumptions for questions that other owners hold (decision 5 for D08, decisions 12-16 and 14b for D09). This ticket writes them down as ADR-0006.

The ADR is **provisional** under Ta's delegation of 2026-09-27. It is not accepted: Ta's and the tech lead's acceptance moves to the W4b exit review (W4-14), and W4-05 and W4-07 may merge on the provisional ADR (register row "W4b delegated rulings (provisional)"). D08 and D09 stay open; the ADR names no model provider and no hosting, and it cannot widen what D08 will permit.

The ticket also lands the document changes the plan assigns to it (section 19): the ADR index row, threat-model rows for parser isolation, model input and the absence of a provider, a dated note in upload safety section 10, and a dated W0-02 section 4 note that W4b adds no dependency.

Not here: any application code, configuration key, migration or test (W4-05a onwards). Synthetic data only; no network call; nothing deploys.
