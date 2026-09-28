# Plan

1. Board CLAIM on `lane-a-workflow-server.md`. Change frame (this folder).
2. RED:
   - `server/src/configuration/{qc-rules,seed}.test.ts`: both params schemas required and checked; seeded params in both templates.
   - `server/src/qc/content/rules/acc-extraction-not-hallucination.test.ts`: fires on an extraction-only "Yes" (DOCX, PDF, XLSX, Thai labels), one finding per claim, identical claims merged, measure contents; silent on an accepted metric, on an accuracy item, on DPO and IT/Security attempts (no read).
   - `server/src/qc/content/rules/acc-classic-ml-metric.test.ts`: passes with a matching metric and value or a reasoned N/A; fires with a claim locator (no metric, a non-matching metric, a metric without value, N/A without reason) or with `absent`; slot 1 not applicable / missing raises nothing; lane scope; `model_type` routing with the seeded selection.
   - `server/src/qc/content/runner.test.ts`: the seeded `classic_ml` selection completes; the seeded `llm` selection is still refused.
   - `fixtures/src/evaluation/content-rules.test.ts`: every implemented content rule against the dev-split labels.
3. GREEN: `shared/src/schemas/cases.ts`, `server/src/configuration/seed.ts`, `server/src/qc/content/rules/{acc-extraction-not-hallucination,acc-classic-ml-metric,index}.ts`.
4. Documents: W0-07 3.5 dated note.
5. Full gate, one suite at a time, logs under `/tmp/rai-w4-06b-acc-extraction-not-hallucination-logs/`.
6. review.md, DEVLOG, CHANGELOG; commit, push, verify the remote head, open the PR ("Refs #228").
