# Intent: ACC-EXTRACTION-NOT-HALLUCINATION and ACC-CLASSIC-ML-METRIC (W4-06b, #228)

W4-06a gave QC a content runner, the provisional synthetic claim grammar and the first content rule, `ACC-METRIC-CITED`. The seeded approve-attempt catalogue still lists three `ACC-*` rules the runner cannot execute, so the runner refuses such a request (`unknown_content_rule`).

This ticket adds two of them, the source spec's accuracy rules that need to read what slot 1 says:

- **`ACC-EXTRACTION-NOT-HALLUCINATION`**: extraction accuracy is not a hallucination rate (PRD: "Extraction accuracy is not hallucination rate"). A claim on the hallucination item that cites an extraction metric is flagged, one finding per claim, with the stated figure as the measure.
- **`ACC-CLASSIC-ML-METRIC`**: a classic-ML model uses its sheet's matching metric or a justified N/A (source spec QC: "Classic-ML uses that sheet's matching metric or N/A"). An attached slot 1 passes when a performance claim cites a matching metric with a value, or answers N/A with a reason; otherwise it is flagged, citing the performance claims or, when there are none, the artifact with an `absent` locator. A slot 1 marked not applicable with a reason is metadata and raises nothing.

Both rules read slot 1 on the AI/COE approve attempt only (decision 28), so DPO and IT/Security attempts never read slot 1. `model_type` routing (`qc/select.ts`, unchanged) keeps the classic-ML rule on `classic_ml` cases and the extraction rule off them. Each rule's params schema lands with its seed params in both templates, so the seed still validates. With these two in place, a classic-ML case's seeded approve-attempt selection runs end to end on the content runner.

It is W4b ticket 13 (track T4, rules) and implements the [W4b plan](../../docs/engineering/implementation-plan-w4b.md) section 15 row W4-06b and sections 3.1 and 3.3 under the register rows "Ta's delegation (2026-09-27)" and "W4b delegated rulings (provisional)". The runner stays unbound in every `QC_MODE` until W4-13b, so no running desk changes behaviour. D07-D10 stay open; the rules, their metric lists and item keywords are provisional until D09 (WA-D09). Synthetic data only; no network call; no migration.
