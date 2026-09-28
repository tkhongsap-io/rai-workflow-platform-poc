# Intent: Admin UI, simple-kind editors, draft and publish (W6-06, #249)

Ta's north star (2026-09-27) is a review desk that streamlines the workflow, tracks version history and shows a dashboard, on synthetic data. W6-02 to W6-04 made configuration versioned on the server (drafts, publish with a change note, restore) and W6-05 let the Admin read it and roll back. The Admin still cannot change a value without calling the API by hand. This ticket gives the Admin the editors for the simple kinds and the draft-and-publish flow, so a configuration change needs no redeploy and no developer.

- On each simple kind's page, a form for its values: SLA working days per lane, the working-day calendar's holidays, the use-case group list, the operator mail recipients and the checklist template versions.
- "Save draft" keeps half-finished work on the server (Q18); the page then lists what publishing would refuse (schema, template coverage, a non-synthetic recipient), in words, beside the field.
- "Publish" asks for a required change note in a dialog and publishes the draft as the next revision; the history then shows it.
- A stale page never overwrites someone else's work: a 409 `configuration_changed` shows the guidance and a Reload button that loads the revision in force and the current draft. A draft started from an earlier revision can be discarded or started again from the revision in force (W6 plan section 2.3).
- Thai and English, keyboard, axe at three widths.

Order 6 of the [W6 plan](../../docs/engineering/implementation-plan-w6.md) (sections 1.2 Q1, Q4, Q5, Q16 and Q18, 2.1 to 2.4, 4.2, 9 and 13; row W6-06), under the register rows "Ta's delegation (2026-09-27)" and "W6 delegated rulings (provisional)". Not in this ticket: the QC rule catalogue editor (W6-07), the JSON editors for the identity mapping and the risk rubric (W6-11, W6-12), the desk-controls switches (W6-17). No migration, no server change. Synthetic data only; no network call; no deploy.
