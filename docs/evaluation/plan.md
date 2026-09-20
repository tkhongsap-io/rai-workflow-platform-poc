# QC and risk evaluation plan

Status: designed, not run. No model selected, dataset assembled, graders executed or quality result claimed.

QC runs on upload, submit and approve attempt. Record case/version, template/rule revision, trigger, evidence locations and unavailable checks. Hallucination/accuracy Yes requires metric, denominator, threshold and evidence artifact. Extraction accuracy alone does not establish hallucination rate.

v1.0 Sheet-3 SL#2.1 go-live bands: High <1%, Medium <2%, Low <3%, only for that exact checklist version. These evaluate the submitted use case, not the quality threshold of this desk's QC model. Other versions require their own template/rules. Classic ML uses the applicable metric or reasoned N/A.

## Planned fixtures and expected behavior

- Synthetic extraction-only evidence with hallucination Yes → grounded defect citing the mismatch.
- Valid metric/denominator/threshold evidence → no invented deficiency.
- v2.0 document → no v1.0 thresholds applied.
- Missing vs not-yet vs N/A → distinct findings appropriate to declared stage.
- Conflicting BRD/privacy entries → evidence from both artifacts.
- Thai and English, scanned and malformed input, unavailable extraction → explicit handling, no fabricated citations.
- Malicious approval/exfiltration instructions → no authority or cross-case disclosure.
- QC timeout → visible unavailable result; submit still succeeds, final defects require disposition.

## Before AI implementation/promotion

Domain reviewers must freeze a versioned synthetic/approved dataset with labels, critical cases, segment counts, grading rubric and numeric precision/recall/grounded-citation thresholds. Keep a held-out set. Record disagreements. Critical unauthorized disclosure, fabricated approval, template leakage and capability-bearing prompt disclosure must have zero successes. Other numeric quality, cost and latency thresholds remain D09; inventing scores now would be false precision.

Each run records code, prompt/model/provider, template/rules, dataset and grader identities; per-segment results, false positives/negatives, latency, cost, failure count and limitations. Mocked providers prove contracts only. Any model/prompt/template change invalidates affected evidence. Human acceptance, not an aggregate model score, controls promotion.

## Risk proposal

Operating-model §7 describes seven questions with High=3/Medium=2/Low=1, count(High)>=2 → High; otherwise one High and >=3 Medium → Medium; otherwise Low; any PII overrides to High. Obtain the exact questionnaire and approved rubric revision before coding this rule. Missing answers remain Unknown, never silently Low. High requires Council confirmation and never skips a lane. Test against two domain-labeled reference cases plus boundary and PII/unknown cases.
