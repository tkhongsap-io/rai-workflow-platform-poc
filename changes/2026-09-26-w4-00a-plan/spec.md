# Specification

Done when:

1. The register holds three dated rows with approver, channel and affected documents: "W4a gate entry", "D05 refinement (upload slot 5 and 9)" and "W4a kickoff rulings".
2. BUILD_PLAN carries the W4a gate entry as a new dated status section; package text stays as written.
3. AGENTS, team-and-roles, the delivery README, README, the W4 work breakdown, the W4 decision briefs and the ADR index say W4a is authorized and W4b is not.
4. `docs/engineering/implementation-plan-w4a.md` answers what W4-00 must: paths, commands, the `QC_MODE` values and their fail-closed rules, the rule-catalogue shape keyed by `checklist_template_version`, which rules revision an upload run on a draft reads, run-identity fields, W0-10 additions, the substitute revisit outcome, and which tickets are agent-eligible.
5. No application code changes. Links check clean.
