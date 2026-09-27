# Plan

1. Board CLAIM (lane A stream) and a queued `MIGRATION-SLOT` claim (lead-integration stream). Change frame (this folder).
2. RED:
   - `server/src/identity/routes.test.ts`: profile recorded on a provider-mode callback, not on a fixture sign-in; hook called once; upsert keeps first seen; throwing hook does not fail the sign-in.
   - `tests/integration/w7-06-subject-profile.test.ts`: upsert, update, no delete, transactional commit and rollback, directory after cleanup.
   - `tests/integration/w1-00-migrations.test.ts`: table and grant lists.
3. GREEN: `db/schema/subject-profile.ts`, `db/schema/index.ts`; `npm run migrate:generate`, then the header, comments and grants by hand in `server/drizzle/0013_w7_06_subject_profile.sql`; `db/migration-classes.ts` entry; `identity/session.ts`, `identity/session.memory.ts`, `identity/routes.ts`, `app.ts`; `cases/subject-directory.ts`; `tests/support/db.ts` `BUSINESS_TABLES`.
4. Docs: W0-03 section 6, W0-04.
5. Full gate one suite at a time, logs under `/tmp/rai-w7-06-subject-profile-logs/`.
6. review.md, DEVLOG, CHANGELOG; commit, push, verify the remote head, open the PR ("Refs #217").
