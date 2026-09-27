# Intent: `subject_profile` (W7-06, #217)

Outside `fixture` mode the desk knows a person only through the `session` rows their sign-ins left. Those rows are operational data: `db:cleanup` removes expired and revoked ones, and a restore never carries them (W7-01). After a cleanup, a case owner's display name can no longer be resolved, and W7-07 has no source for mail recipients at all, because today they come only from the fixture identities.

This ticket gives `network` and `local-google` a persisted, minimal profile of each person who has signed in, under the [W7 plan](../../docs/engineering/implementation-plan-w7.md) section 4.1 and section 9 row W7-06, and the register rows "Ta's delegation (2026-09-27)" and "W7 delegated rulings (provisional)" (W7-D10 option A: a `subject_profile` row upserted at each sign-in):

- a `subject_profile` table (subject, identity mode, email, display name, role snapshot, first seen, last sign-in), writable by `rai_app` but never deletable (removal is a D08 retention question; working assumption: kept while the deployment lives, removed with the database);
- the upsert lives in `SessionStore.create`, in the same transaction as the session row and the `identity.signed_in` audit row, so a profile never exists for a sign-in that did not commit, and vice versa;
- `establishSession` passes the profile on every non-fixture sign-in and then calls an optional `profiles.recorded` hook, which W7-07 binds to the in-memory recipient directory;
- the case subject directory reads the profile before falling back to `session`, so display names survive `db:cleanup`.

Not here: the recipient directory, the mail file drop and the business-unit directory (W7-07), the A01 network suite (W7-08). Email and name are those of synthetic principals only until D08. Synthetic data only; no external network call; nothing is deployed.
