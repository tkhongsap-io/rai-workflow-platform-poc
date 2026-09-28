# Plan: Admin configuration API (W6-04, #231)

Recorded before code. Paths per the W6 plan row W6-04, plus the two wiring files and the locale catalogues the route needs (see review Deviations).

1. **Tests first (RED).** `rai-web/tests/integration/w6-04-admin-configuration.test.ts` on the in-process fixture app (real Postgres): index shape and ownership; revision list order, paging and `frozenOnVersionCount` after a submit; revision detail and 404s (unknown kind, malformed, unknown and other-kind revision); draft read/save/replace/discard; 409 `configuration_changed` details for save, discard, publish and restore; 422 fields for draft rejections, change note, `restore_current` and publish problems (unknown rule; template coverage; non-synthetic recipient), with nothing written; publish and restore 201 summaries and the next submit's frozen revision; audit rows for each write and none for a refusal; log lines `configuration.published` / `configuration.publish_refused` without body values; T40: every non-Admin fixture identity 403 on every route (and an unknown kind), 401 without a session. `rai-web/server/src/configuration/routes.test.ts` unit-tests the problem-to-`FieldError` mapping. Run and watch fail.
2. **Log catalogue** `server/src/observability/log.ts`: the two events.
3. **Routes** `server/src/configuration/routes.ts`: `registerAdminConfigurationRoutes(fastify, { db, now, emitter, subjects?, mailMode? })`, response schemas from the shared shapes, store calls, error mapping, log lines.
4. **Wiring** `app.ts` (`AppDeps.configuration`, registered under `identity`), `compose-app-deps.ts` (subjects and `config.mail?.mode`).
5. **Locales** th/en keys listed in the spec.
6. **Docs** W0-02 7.9 annotation, W0-10 3.3 rows and dated note.
7. **Gate**, review.md, DEVLOG, CHANGELOG, commit, push, PR.
