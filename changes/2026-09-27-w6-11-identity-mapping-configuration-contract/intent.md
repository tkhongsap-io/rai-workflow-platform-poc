# Intent: identity-mapping configuration contract (W6-11, #255)

Ta's north star (2026-09-27) is a review desk that streamlines the workflow, tracks version history and shows a dashboard, on synthetic data. W6-02 to W6-06 made every configuration kind versioned with drafts, publish, history and restore, and gave the Admin editors for the simple kinds. The AD group-to-role mapping (`group_role_mapping`) is still the one registered kind with no body schema, so it cannot be drafted meaningfully or published, and the identity adapter reads a revision nobody can create through the desk.

This ticket closes that contract:

- `GroupRoleMappingSchema` moves from the server to `shared/src/schemas/identity-mapping.ts` (re-exported from `server/src/identity/group-mapping.ts`, so no import breaks) and is registered for `group_role_mapping`. It stays in `UNSEEDED_KINDS`: the seed and the fixtures contain no mapping.
- The Admin publish path accepts a synthetic mapping and refuses an invalid one, with the usual problems.
- The kind page gets a schema-validated JSON editor with a warning: the mapping is read only at start in `network` (`ad` source) and `production` modes, and is ignored by `fixture`, `local-google` and `network` with the allow-list; publishing needs no redeploy, but a restart to apply.
- [Identity adapter 9.2](../../docs/engineering/identity-adapter.md) gets a dated amendment.

Order 11 of the [W6 plan](../../docs/engineering/implementation-plan-w6.md) (sections 3, 6 and 11.2; row W6-11), under the register rows "Ta's delegation (2026-09-27)" and "W6 delegated rulings (provisional)". Real tenant and group IDs stay D10 and W8. Whether a change should apply without a restart stays W7/W8. No migration. Synthetic data only; no network call; no deploy.
