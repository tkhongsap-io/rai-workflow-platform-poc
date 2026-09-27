# Spec: `subject_profile` (W7-06, #217)

Source: [W7 plan](../../docs/engineering/implementation-plan-w7.md) section 4 (migration table), 4.1, section 5.3 (the W7-07 hook it serves), section 9 row W7-06, section 9.1 (migration numbering, shared test lists), section 14 (W0-03 section 6 and W0-04 amendments). The plan wins over issue #217.

## Migration `0013_w7_06_subject_profile` (class `additive`)

`subject_profile`:

| Column            | Type                                                                             |
| ----------------- | -------------------------------------------------------------------------------- |
| `subject_id`      | `text PRIMARY KEY` (`<issuerKey>:<subject>`, W0-03 section 2.2)                  |
| `identity_mode`   | `text NOT NULL CHECK (identity_mode IN ('local-google','network','production'))` |
| `email`           | `text NOT NULL` (lower-cased, from the principal)                                |
| `display_name`    | `text NOT NULL`                                                                  |
| `roles`           | `jsonb NOT NULL` (the principal's `RoleScope[]` at this sign-in)                 |
| `first_seen_at`   | `timestamptz NOT NULL` (set by the first sign-in, never updated)                 |
| `last_sign_in_at` | `timestamptz NOT NULL`                                                           |

Grants: `SELECT, INSERT, UPDATE` to `rai_app`; no `DELETE` for anyone at runtime. No trigger: rows are mutable by design (each sign-in refreshes them) and are not evidence; not in `frozenDigest`; no audit event of its own (the `identity.signed_in` row in the same transaction is the audit). It is in the backup (`backup.ts` dumps every public table except `session`). Header `rollback expectation: additive;` and a `MIGRATION_CLASSES` entry `additive`.

## Session store

- `CreateSessionInput.profile?: { email: string; displayName: string }`.
- `SubjectProfile` (exported from `identity/session.ts`): `{ subjectId, identityMode, email, displayName, roles, firstSeenAt, lastSignInAt }`.
- `SessionStore.create` returns `{ session, token, profile? }`; `profile` is present exactly when `input.profile` was given.
- Pg (`createPgSessionStore`): inside the one `withTransaction` that inserts the session and appends `identity.signed_in`, after both, `INSERT INTO subject_profile ... ON CONFLICT (subject_id) DO UPDATE SET identity_mode, email, display_name, roles, last_sign_in_at = excluded.*` (`first_seen_at` kept), `RETURNING *`. Any failure rolls back the session and the audit row too.
- Memory (`createMemorySessionStore`): a `profiles: Map<subjectId, SubjectProfile>` with the same upsert rule (first seen kept), refusing `identityMode: 'fixture'` with a profile as the Pg CHECK does (rejects and writes nothing).

## Route

- `AuthRouteDeps.profiles?: { recorded(profile: SubjectProfile): void }`; `IdentityDeps.profiles?` in `app.ts`, passed through to `registerAuthRoutes`.
- `establishSession` in the callback path (every non-fixture mode) passes `profile: { email: principal.email, displayName: principal.displayName }` (the principal is minted from the verified login by `principalFrom`, which lower-cases the email and derives the display name). The fixture sign-in passes none.
- After `create` resolves, when it returned a profile, `deps.profiles?.recorded(profile)` is called once. A throwing hook is not the sign-in's failure: the session committed, so the error is logged (`auth.profile.hook_failed`, no values) and the sign-in answers as usual. (Deviation, see review.md.)

## Subject directory

`createSubjectDirectory` resolves in order: `known`, the actor, `subject_profile.display_name`, then the newest `session` principal. No email is read.

## Tests

- Unit (`identity/routes.test.ts`, memory store): a local-google-shaped callback records one profile with the principal's email and name and calls `recorded` once with it; the fixture sign-in records none and does not call the hook; a second sign-in updates `lastSignInAt` and roles, keeps `firstSeenAt`; a throwing hook still yields 303 and a session.
- Integration (`tests/integration/w7-06-subject-profile.test.ts`, real Postgres, `local-google` adapter through the `discovery` and `exchange` seams): one sign-in upserts one row; a second updates `last_sign_in_at` and `roles` (role map changed between the two) and keeps `first_seen_at`; `rai_app` cannot `DELETE` (42501); the upsert commits with the session and audit rows and a failing upsert rolls both back; the subject directory resolves the name after the session rows are gone (revoked and swept by `sweepSessions` as `rai_operator`).
- `w1-00-migrations.test.ts`: table and three `rai_app` grants added to the lists. `tests/support/db.ts` `BUSINESS_TABLES` gains `subject_profile` so each test starts empty.
- `migration-classes.test.ts` (unchanged) covers the new header and entry.

## Docs

W0-03 section 6: dated W7-06 note (the profile, when it is written, what reads it). W0-04: `subject_profile` row and roles note (dated W7-06 amendment).
