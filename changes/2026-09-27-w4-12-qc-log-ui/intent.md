# Intent: QC log, evidence and unavailable runs in the UI (W4-12, #189)

W4-11a, W4-02, W4-03 and W4-04 record everything a reviewer needs to judge a QC result: which runner ran, which rule revision it applied, how many rules it evaluated, whether it was unavailable and why, and where each finding's evidence points. None of it reaches a screen yet. The findings read shows a message, a slot and a lane; the reviewer workspace shows only the outage of the lane's own approve-attempt run; a completed run that evaluated no rules reads exactly like "no defects".

This ticket makes that record readable. It is the sixth W4a ticket (plan section 9, order 6) and implements [W4a plan](../../docs/engineering/implementation-plan-w4a.md) section 7 under the register rows "W4a gate entry", "D05 refinement (upload slot 5 and 9)" and "W4a kickoff rulings" (Ta, 2026-09-26):

- the finding read shapes gain `evidence` (locators only, never an excerpt hash or text);
- a new read, `GET /api/cases/{caseId}/versions/{versionId}/qc-runs`, authorized exactly like that version's findings read;
- a "QC log" on the version view listing every run;
- every unavailable run on the version, from any trigger, shown in the reviewer workspace before the decision controls;
- a finding row showing its rule label, rule ID, evidence location and owning lane;
- an unavailable run and a completed run with 0 rules evaluated each reading visibly differently from "no findings".

Agent-eligible; the read shapes are contract (W0-02 section 7 amendment in this PR). The disposition flow is unchanged. The in-memory API substitute is not extended (W4a kickoff rulings). Not here: any rule, runner, trigger or storage change, finding dedup (W4b), document parsing, a model or provider. Synthetic data only. Rule outcomes stay provisional until D09.
