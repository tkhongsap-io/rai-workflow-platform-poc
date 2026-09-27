# Review: Admin configuration API (W6-04, #231)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W6 plan](../../docs/engineering/implementation-plan-w6.md) sections 2.3, 2.4, 4.2 and 10, row W6-04 (the plan wins over issue #231). Decisions implemented: register rows "Ta's delegation (2026-09-27)" and "W6 delegated rulings (provisional)" (Q1, Q3, Q4 single-Admin publish, Q5, Q18). D07, D09 and D10 stay open: their kinds are served with `valuesOwner` `D07`/`D10` and are not given values here. Synthetic data only; no network call, no model, no deploy. No migration.

## Change

- **Routes** `rai-web/server/src/configuration/routes.ts` (`registerAdminConfigurationRoutes`): the eight routes of plan 4.2 with TypeBox params, query, body and response schemas from `@rai/shared/schemas/configuration-admin`. Reads `config.read_revisions`, writes `config.publish`, target `none` (the middleware answers 401/403 first). Unknown kind → 404 `configuration`; malformed, unknown or other-kind revision → 404 `configuration`. Writes run in `withTransaction` with the app clock, the Admin's subject and role, the request correlation ID and `MAIL_MODE`. `problemFields` maps store problems to FieldErrors; `contractError` maps the store's errors (spec table). `frozenOnVersionCount` is one grouped count over `pack_version.frozen_configuration ->> kind`.
- **Wiring** `app.ts` (`AppDeps.configuration`, registered inside `identity`) and `compose-app-deps.ts` (`configuration: { subjects, mailMode: config.mail.mode }`; `config.mail` optional so the in-process harness, which has none, stays a sink).
- **Logs** `observability/log.ts`: `configuration.published` (info) and `configuration.publish_refused` (warn).
- **Locales** th/en: 13 `validation.configuration.*` keys and `error.invalid_input.restore_current`, inserted in sorted position.
- **Docs**: W0-02 7.9 annotated (dated); W0-10 3.3 rows and a dated amendment note.
- **Audit**: unchanged code; `configuration.draft_saved`, `configuration.draft_discarded` and `configuration.published` were registered by W6-02 and are written by the store. `audit/store.ts` needed no edit.

## Tests

- `rai-web/server/src/configuration/routes.test.ts` (5, unit): coded problems keep the full pointer (with spaces) and map to `validation.configuration.<code>`; every W6-03 code has a locale key; schema problems keep only the first pointer segment and no prose; unregistered kinds map to `not_editable`; every key produced from real `publishProblems` output is a locale key.
- `rai-web/tests/integration/w6-04-admin-configuration.test.ts` (13, real Postgres, fixture app): index order, owners, editability and seed state; history newest first, paging, `frozenOnVersionCount` equal to a direct count after a submit, detail body, query 422; 404 `configuration` for nine unknown-kind / bad-revision requests; draft save/replace/read/discard with problems and audit rows; cross-kind draft problem key without leaking the address; 409 `configuration_changed` details for save and discard with no audit row; 422 for array body, over 64 KiB, other-kind base, blank note; publish 201 with audit (`before_ref` the seed, no note), `configuration.published` fields, no leak (`assertNoLeak`), the next submit freezes the new revision; stale publish 409 ×2 with `publish_refused` `stale`; invalid catalogue 422 with `rule_not_implemented` and `catalogue_missing_template`, draft kept, `publish_refused` `invalid` with the field count, and a note-less publish refused; restore 201 as N+1 with `restoresRevisionNumber`, audit `restores_configuration_revision_id` and the log field, plus `restore_current`, stale and blank-note refusals; a restore whose body fails today's coverage check → 422 `catalogue_missing_template`; **T40**: all seven non-Admin fixture identities are 403 on all nine requests (eight routes plus an unknown kind), each with an `authz.denied` reason `role`, no session is 401, nothing written.

## TDD evidence

- RED: `node --import tsx --conditions=rai-source --test server/src/configuration/routes.test.ts` → failed (module `./routes.js` not found).
- RED: `tests/integration/w6-04-admin-configuration.test.ts` before the routes → every test failed with `404 !== 200` (`not_found`: no such route).
- First GREEN run surfaced a 500 on every read (Postgres rejected `GROUP BY frozen_configuration ->> $n` because the grouped expression carried a different bound parameter); fixed by grouping by position. Then 13/13 pass.

## Gate (from `rai-web` after `set -a; . ./.env; set +a`, lane DB on 55384, ports 8831/8832/8833/5194, 2026-09-28)

| Command | Result |
|---|---|
| `npm run lint` | exit 0 (eslint, "All matched files use Prettier code style!", check-css) |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | exit 0; 1054 tests, 1054 pass, 0 fail |
| `npm run test:integration` | first run exit 1: 461/467, the 6 failures all in `w7-01-backup` and `w7-02-backup-restore` with `pg_tools_container_not_found`, because this lane's `.env` still named the compose project `rai-dev` (`RAI_PG_TOOLS`) while the lane database runs as project `rai-admin`. With `RAI_PG_TOOLS=docker-compose:rai-admin` in the uncommitted `.env`: exit 0; 467 tests, 467 pass, 0 fail |
| `npm run build && npm run check:substitute-absent` | exit 0 |
| `npm run test:browser:server` | exit 0; 217 passed (8.4m) |
| `npm run test:browser:substitute` | exit 0; 48 passed |
| `node scripts/check-links.mjs` (repo root) | exit 0; 473 Markdown files, 0 broken |
| `git diff --check` | exit 0 |

No test was re-run for load; no flake was observed. No existing test changed.

## Deviations

Choices made under Ta's delegation of 2026-09-27 where the plan is silent; each keeps the plan's contracts.

- **Files beyond the row's paths:** `compose-app-deps.ts` (the route needs the subject directory and `MAIL_MODE`, and start.ts and the test harness both build the app from it), the th/en locale catalogues (a FieldError's `messageKey` must be a `LocaleKey`; W6-03's review assigned these keys to W6-04), and `server/src/configuration/routes.test.ts`. `audit/store.ts` is in the row's paths but already held the actions (W6-02), so it is unchanged.
- **"Current" and `inForce` are the kind's latest published revision**, as in the W6-02/W6-03 store's optimistic and cross-kind checks, so the index shows exactly the `expectedCurrentRevisionId` the next publish must name. Under `after_publish` it is in force for every event after its publish instant; reading "in force at this instant" instead would show the previous revision for the publishing instant itself.
- **Problem paths** are JSON pointers into the configuration body (`/templates/v2.0/rules/3`), the same form in the draft's `problems` and in a 422's `fields`, so the SPA maps both one way. Other 422s keep request paths (`body.changeNote`, `params.revisionId`). A schema problem is reduced to its first pointer segment, because the store's strings put free text after a pointer that may hold spaces; the prose is never served since it can echo values.
- **`publish_refused`** is emitted for publish and restore refusals only (409 and 422), not for a 404 or for a refused draft save; `problemCount` is 0 for a stale refusal.
- **Unknown kind on a write** is 404 after authorization, so a non-Admin sees 403 whatever the kind (no existence oracle), as T40 requires.
- **Pagination** uses `CONFIGURATION_REVISION_LIST_DEFAULTS` (page 1, 25) from the W6-01 contract.

## Not in scope

Admin UI (W6-05 to W6-07), activation proof (W6-08), desk-controls enforcement and the `desk_controls.changed` event (W6-17), `group_role_mapping` registration (W6-11), W8.
