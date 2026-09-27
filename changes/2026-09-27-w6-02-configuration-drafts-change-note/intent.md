# Intent: configuration drafts, change note, restore and the desk_controls kind (W6-02, #214)

W6 lets an Admin change the desk's configuration (checklist templates, QC rules, SLA, calendar, recipients, use-case groups) without a redeploy, and roll a change back. Before any route or screen can do that (W6-04 onwards), the store underneath has to support it without weakening the one guarantee the review history relies on: a published configuration revision never changes.

This ticket adds the store half, in one forward-only migration and the store functions over it:

- a mutable **draft** per kind (`configuration_draft`), which is an Admin working copy and not evidence, so it can be saved half-finished, discarded and replaced; publishing copies it into a new immutable revision (W6 plan Q1);
- a required **change note** on every revision a person publishes, stored on the revision row (seed rows keep none);
- **restore**: publishing a copy of an older revision as the next number, with a link back to the revision it restores, so history stays forward-only (Q3);
- optimistic checks on every draft write and publish (Q5), so two Admins can never silently overwrite each other;
- the `desk_controls` kind (`writesFrozen`, `mailPaused`, `qcPaused`), registered and seeded with all three off, so W6-17 can build the incident switches on it (Q12);
- the separation of registered from seeded kinds (`UNSEEDED_KINDS`), so W6-11 can register the identity mapping without the seed having to invent one;
- the submit freeze skipping the two kinds that are not evidence about a case (`desk_controls`, `group_role_mapping`).

The migration's rollback class is `restore-required`: after it, a `desk_controls` revision can exist that an older binary's kind list does not know.

It is order 2 on the Admin configuration stream of the [W6 plan](../../docs/engineering/implementation-plan-w6.md) (sections 2.3 and 3, row W6-02), under the register rows "Ta's delegation (2026-09-27)" and "W6 delegated rulings (provisional)". No route, UI or cross-kind validation (W6-03, W6-04). Synthetic data only; no network call; no deploy.
