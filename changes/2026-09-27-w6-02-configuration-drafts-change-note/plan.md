# Plan

1. Board CLAIM on Lane A and a MIGRATION-SLOT queued claim on the lead-integration stream. Change frame (this folder).
2. RED, run and watched failing on the current code:
   - `shared` / `server` unit: `desk_controls` registered and its schema; the shared and db kind lists equal; `seed.test.ts` by kind with `UNSEEDED_KINDS`; `freeze.test.ts` skipping `UNFROZEN_KINDS`; `audit/store.test.ts` names the two new actions.
   - integration: `w6-02-configuration-drafts.test.ts` (spec item 8); `w1-00-migrations.test.ts` lists; `w1-05-submit.test.ts` frozen kinds by name; `BUSINESS_TABLES`.
3. GREEN:
   - shared registration and owner map; seed type and entry; freeze skip; audit actions;
   - Drizzle schema files; `npm run migrate:generate` for `0011_*`, the journal and snapshot; tag renamed to `0011_w6_02_configuration_admin`; SQL replaced by the hand-written migration; `migrate:generate` again reports nothing;
   - store functions and error classes.
4. W0-04 amendment.
5. Full gate, one suite at a time, logs under `/tmp/rai-w6-02-configuration-drafts-change-note-logs/`.
6. review.md, DEVLOG, CHANGELOG; commit, push, verify the remote head, open the PR ("Refs #214").
