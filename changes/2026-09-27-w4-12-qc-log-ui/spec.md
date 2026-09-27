# Specification

Source: W4a plan section 7 (the plan wins over issue #189), section 8 (commands), section 10 (test layers), section 11 (substitute) and section 12 (W0-02 section 7 amendment), with the plan-review notes on the ticket.

Done when:

1. **Evidence on the read shapes.** `StoredFindingSummary` (lane qc-run response) and `FindingWithDisposition` (findings read) carry `evidence: Array<{ slot, artifactId, locator }>`, built from the stored `qc_finding.evidence`. `locator` is the W0-07 3.3 `EvidenceLocator` (`page`, `text_range`, `cell`, `section`, `absent`). `excerptHash` and `contentHash` are never exposed. A stored entry whose locator is not one of those kinds is left out rather than passed through.
2. **qc-runs read.** `GET /api/cases/{caseId}/versions/{versionId}/qc-runs` → `200 { runs: QcRunSummary[] }`, in `requested_at` order (then `id`). `QcRunSummary = { runId, trigger, lane, slot, status, unavailableReason, runner, runnerVersion, ruleRevision, rulesLabel, rulesEvaluated, findingCount, requestedAt, completedAt }`:
   - `runner` is `qc_run.engine_id`; `runnerVersion` `qc_run.runner_version` (`unrecorded` on pre-W4a rows);
   - `ruleRevision` is the recorded revision ID; `rulesLabel` is the `label` of the `qc_rules` configuration revision with that ID, `null` when the ID names no `qc_rules` revision;
   - `rulesEvaluated` is `null` on rows written before migration 0009;
   - `findingCount` counts the run's stored `qc_finding` rows (an unavailable run's QC-UNAVAILABLE finding included);
   - timestamps are ISO strings.
3. **Scope.** The route uses the same authorization as the findings read: action `version.view` on the case (W0-05), then 404 for a malformed version ID, an unknown one, or one of another case. A draft's runs are therefore readable by exactly those who may read the draft's findings. 401 without a session. The read writes nothing.
4. **QC log.** The submitted-version view shows a "QC log" section listing every run with its trigger, lane or slot, status, runner and version, rule revision (label, or the ID when no label), rules evaluated, finding count and time. A run reads as one of: findings recorded; no findings (≥1 rule evaluated); **0 rules evaluated, not a clean pass**; **QC unavailable (reason), not a clean pass**. An empty log says so. A failed read shows the error notice with reload inside the section; the rest of the view stays.
5. **Unavailable runs before the decision controls.** A lane's reviewer workspace lists every unavailable run on the version, whatever its trigger, above the findings and the decision controls, in one block. The lane's own run result is unchanged otherwise, except that a completed lane run with 0 rules evaluated reads "0 rules evaluated, not a clean pass" instead of "found no defects". The workspace loads the runs with the findings; if the runs read fails, the workspace shows its error with reload and offers no decision controls.
6. **Finding row.** Each row shows the message (as today), the rule label (`qc.rule.*` key from the rule ID; the ID alone when no key exists), the rule ID, the evidence location (slot and locator kind per entry) and the owning lane. The disposition controls are unchanged.
7. **Locale.** Every new string has th and en keys; no hard-coded strings.
8. **Browser proof** on the real server under the evidence configuration (`QC_MODE=substitute`): th and en, 1440/834/390, axe zero critical, keyboard-only reach of the QC log and the unavailable block before the decision controls; the existing W2 and W3 specs still pass (expectations changed only where this behaviour changes them).
9. **Integration tests**: shapes, order and label (and `null` label), evidence without hashes, scope (401, 403 other owner and other BU, 404 unknown/malformed/other case, reviewer on a draft = findings read), no write. The real-server test reads the endpoint over HTTP under `QC_MODE=deterministic`.
10. **Docs.** Dated W0-02 section 7 (7.7) amendment. Substitute: not extended; what a substitute-served screen does with the new read is recorded in review.md.
11. Full plan section 8 gate green.
