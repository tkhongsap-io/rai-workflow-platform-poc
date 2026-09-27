# Intent: risk migration and Drizzle schema (W5-03, #205)

W5 records a proposed risk tier for each submitted version. Before any ticket can save questionnaire answers (W5-04) or record a proposal at submit (W5-05), the database needs somewhere to keep them, and it must keep them the way the desk keeps every other piece of review history: frozen with the version, and never rewritten.

This ticket adds exactly that and nothing else, in one forward-only migration and the matching Drizzle schema:

- `pack_version.risk_answers`, a JSON column that is editable on the draft and frozen with the rest of the row at submit by the existing whole-row freeze trigger;
- `unknown` as a fourth value of `case.risk_tier`, because missing evidence must stay Unknown and never become Low; the existing projection gate still lets only the workflow write it;
- the append-only `risk_proposal` table: one row per proposal, at most one submit proposal per version, never updated or deleted, readable and insertable by the application role only.

The migration's rollback class is `restore-required`: once a submit writes `risk_tier = 'unknown'`, an older binary cannot read that value, so rolling back past it means restoring a backup (W5 plan section 9, W7-03).

It is order 1 on the A lane in section 9 of the [W5 plan](../../docs/engineering/implementation-plan-w5.md) and implements section 5 under the register rows "Ta's delegation (2026-09-27)" and "W5 delegated rulings (provisional)". No writer, route, seed or UI. D07 stays open for AI/COE; nothing here encodes rubric content. Synthetic data only; no network call; no deploy.
