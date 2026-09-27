# Intent: W6 contract — shared shapes, policy rows, error codes (W6-01, #206)

W6 adds Admin configuration editing (drafts, publish, restore, history), an explicit Admin recheck, desk controls and a desk dashboard ([W6 plan](../../docs/engineering/implementation-plan-w6.md)). Before any of it is built, both halves of the desk need one typed contract to build against, as W2-02 did for W2. This is the first W6 ticket (plan section 11, order 1) and is contract only: no route, no migration, no screen.

It fixes:

- the shapes of the Admin configuration API (plan section 4.2), the dashboard read (section 8.1), the queue drill-down filters (section 8.2) and the optional `SubmittedVersion.frozenConfiguration` (section 4.3), in `@rai/shared`;
- the policy rows `qc.recheck` (Admin only) and `dashboard.view` (all six roles, scoped in SQL by `caseScopeWhere`), with `config.publish` and `config.read_revisions` unchanged and still Admin only (section 4.1);
- the error contract (section 4.2): the new code `desk_frozen` (503), the stale reason `configuration_changed`, the not-found resource `configuration`, their th/en keys, and error capture that records a `DeskFrozenError` as `desk_frozen` at info with no stack, never as `internal_error`;
- the dated amendments to W0-02 (7.10), W0-05, W0-06 (8.1, 8.3) and W0-10.

Authority: register rows "Ta's delegation (2026-09-27)" and "W6 delegated rulings (provisional)". HRR (human review required); merged through the D03 reviewed-ticket flow. Synthetic data only; no external network call; nothing deploys. D07-D10 stay open for their owners: this ticket only names who owns which configured values (`valuesOwner`), it sets none of them.

Not here: any route, repository, migration or screen (W6-02 onward), `desk_controls` registration (W6-02), `group_role_mapping` registration (W6-11), the recheck columns and the `desk_paused` reason (W6-09).
