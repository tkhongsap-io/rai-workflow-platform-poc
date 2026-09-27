# Intent: evaluation set generator, dev split, provisional labels (W4-09a, #203)

W4b makes QC read document contents. Before the content runner is measured, the set it is measured on must exist, be synthetic, be reproducible to the byte, and carry the expected answers written down before any run ([W4b plan](../../docs/engineering/implementation-plan-w4b.md) section 11.1; [evaluation plan](../../docs/evaluation/plan.md) "Planned fixtures and expected behavior").

This ticket builds the **dev split** of `qc-eval-synthetic@1`:

- synthetic case rows (template, model type, stage, vendor flag, slot states, documents) for every item on the evaluation plan's fixture list;
- renderers that write the documents as DOCX, XLSX, text-layer PDF (plain and FlateDecode, several pages), scanned inputs (PNG, image-only PDF), a Thai CID-font PDF and malformed files, on Node built-ins only;
- expected runs and findings per trigger and, for approve attempts, per lane (decision 28), for both run parts (decision 27), labelled by the agent team as provisional (decision 14b; D09 stays open);
- `npm run fixtures:eval:generate`, which writes the bytes to the gitignored `rai-web/.local/eval-fixtures/` and checks them against a committed manifest.

Not here: the held-out split, the variants the dev split never shows, the freeze and `disagreements.md` (W4-09b); the harness, grading and report (W4-08a/b); the probes (W4-10a); any rule, extractor or runner code (W4-05, W4-06). Synthetic data only; no bytes committed; no network call; no model.
