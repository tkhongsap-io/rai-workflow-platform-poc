# Intent: Admin UI, index, history, diff and restore (W6-05, #241)

Ta's north star (2026-09-27) is a review desk that streamlines the workflow, **tracks version history** and shows a dashboard, on synthetic data. W6-02 to W6-04 made configuration versioned on the server: drafts, publishing with a change note, restore as a new revision, and the Admin API under `/api/admin/configuration`. Nobody can see any of it yet. This ticket gives the Admin the screens to read it and to roll back.

- A "Configuration" page, beside "Desk health" in the navigation for Admin, listing every configuration kind with whose values it holds (a "provisional until D07/D09/D10" badge where the values are another owner's), the revision in force, and whether a draft is waiting.
- A page per kind: the revision in force and its body, the draft waiting (if any), and the full history, newest first, with each revision's change note, who published it, what it restored, and how many submitted versions froze it.
- A diff of any two revisions of a kind, by JSON path (added, removed, changed), from a pure, unit-tested `admin/diff.ts`.
- Restore of an older revision with a required change note in a dialog, which publishes a copy as the next revision (Q3); a stale page answers with the reload guidance, a refused restore with its reasons.
- The server still decides access: a non-Admin who opens an Admin URL sees the 403 notice.
- Thai and English, keyboard, axe at three widths.

Order 5 of the [W6 plan](../../docs/engineering/implementation-plan-w6.md) (sections 1.2 Q3 and Q16, 2.3, 4.2 and 9, row W6-05), under the register rows "Ta's delegation (2026-09-27)" and "W6 delegated rulings (provisional)". Not in this ticket: editors, saving a draft and publishing (W6-06), the QC rule editor (W6-07), the JSON editors (W6-11, W6-12), desk controls (W6-17). No migration, no server change. Synthetic data only; no network call; no deploy.
