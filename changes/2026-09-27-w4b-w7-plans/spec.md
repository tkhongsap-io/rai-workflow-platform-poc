# Specification

Done when:

1. The four plans exist under `docs/engineering/` (`implementation-plan-w4b.md`, `-w5.md`, `-w6.md`, `-w7.md`). Each answers what its planning ticket must answer: decisions with options, configuration and fail-closed rules, schemas and migrations, API shapes and authorization, UI and locale keys, logs, tickets with done-when, owner type, lane, dependencies, paths and migration flag, commands, the test-layer map and exit evidence. Each has a "Plan review" section recording its review rounds, and the cross-plan consolidation where it changed that plan.
2. The plans are consistent with one another on:
   - shared tables (`qc_run`, `qc_finding`, `configuration_revision`, `case.risk_tier`, `risk_proposal`);
   - configuration kinds and the seed (`risk_rubric`, `desk_controls`, `group_role_mapping`, the `qc_rules` label and params);
   - migration order and rollback classes, under one `MIGRATION-SLOT`;
   - locale key namespaces and the exhaustive operator-value labels;
   - overlapping endpoints and read shapes;
   - the dashboard's use of W5 and W4b data;
   - the recheck and dedup interplay;
   - QC modes in the rehearsal and deployment notes.
3. `docs/product/decisions.md` holds, after the last recorded row, the row "Ta's delegation (2026-09-27)" and one row per package, "W4b/W5/W6/W7 delegated rulings (provisional)". Each package row lists that package's rulings and its working assumptions, labelled as assumptions. The approver reads "agent team under Ta's delegation of 2026-09-27; Ta to confirm", and each row names the affected documents. D07-D10 stay in the Open table.
4. BUILD_PLAN has a new dated section "Status against this plan — 2026-09-27 (W4b-W7 under Ta's delegation)". It holds the gate entries for W4b, W5, W6 and W7, states which entry conditions the delegation replaces or relaxes for synthetic work, marks every entry provisional, and says W8 is not authorized.
5. These are updated:
   - AGENTS and team-and-roles: authorization extended to W4b-W7 under Ta's direction of 2026-09-27, W8 still gated;
   - the status lines in the delivery README, README, the W4 work breakdown and the later-packages outline;
   - the ADR index: ADR-0006 planned in W4b, provisional.
6. A DEVLOG top entry, a CHANGELOG line under 2026-09-27 and an appended board entry in `docs/board/lane-decisions-and-docs.md` exist. No existing record text is reformatted.
7. No application code changes. `node scripts/check-links.mjs` reports 0 broken links, and `git diff --check` is clean.
