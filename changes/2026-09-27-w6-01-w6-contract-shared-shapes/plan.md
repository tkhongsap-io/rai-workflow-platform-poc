# Plan

1. Board CLAIM (lane A, `docs/board/lane-a-workflow-server.md`). Change frame (this folder).
2. RED (unit tests first, watched failing):
   - `shared/src/errors.test.ts`: `desk_frozen: 503`, the two new locale keys, `DeskFrozenError`, the configuration stale details, `NotFoundError('configuration')`.
   - `server/src/observability/errors.test.ts`: `DeskFrozenError` captured as `desk_frozen` at info with no stack; `NotFoundError('configuration')` captured as `not_found`.
   - `shared/src/schemas/observability.test.ts`: `desk_frozen` safe fields.
   - `server/src/authz/policy.test.ts`: the new rows, T40 unit level, `qc.recheck` Admin only, `dashboard.view` six roles.
   - `shared/src/schemas/configuration-admin.test.ts` (new): the request and response shapes, the owner table, the limits.
   - `shared/src/schemas/dashboard.test.ts` (new): a full response validates; a missing status or lane, an `info` severity or an unknown key is refused; `risk` both forms.
   - `shared/src/schemas/queue.test.ts`: the drill-down filters validate and refuse bad values; the served `QueueQuerySchema` still refuses them until W6-14.
   - `shared/src/constants.test.ts`: `DASHBOARD_DUE_SOON_WORKING_DAYS`.
   - `shared/src/schemas/versions.test.ts` (new): `FrozenConfigurationEntrySchema`.
3. GREEN:
   - `shared/src/errors.ts`, `shared/src/constants.ts`, `shared/src/schemas/{configuration-admin,dashboard,queue,versions,observability}.ts`;
   - `server/src/observability/errors.ts` (`levels`, `http()` branch); `server/src/authz/policy.ts`;
   - `web/src/i18n/operator-labels.ts`; `shared/src/locales/{th,en}.json`.
4. Docs: W0-02 7.10, W0-05, W0-06 8.1/8.3, W0-10, each a dated note.
5. Full gate (plan section 12), one suite at a time, logs under `/tmp/rai-w6-01-w6-contract-shared-shapes-logs/`.
6. review.md, DEVLOG, CHANGELOG; commit, push, verify the remote head, open the PR ("Refs #206").
