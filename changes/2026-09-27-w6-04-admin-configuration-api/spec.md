# Spec: Admin configuration API (W6-04, #231)

Source: [W6 plan](../../docs/engineering/implementation-plan-w6.md) sections 2.3, 2.4, 4.2 and 10, row W6-04 (the plan wins over issue #231). Shapes: `rai-web/shared/src/schemas/configuration-admin.ts` (W6-01), unchanged.

## Routes (`rai-web/server/src/configuration/routes.ts`)

| Route | Action | Success | Refusals |
|---|---|---|---|
| `GET /api/admin/configuration` | `config.read_revisions` | 200 `ConfigurationIndexResponse`: one entry per `CONFIGURATION_KINDS` member in list order | 401, 403 |
| `GET /api/admin/configuration/:kind/revisions?page&pageSize` | `config.read_revisions` | 200 `{ items, total }`, newest first (defaults page 1, pageSize 25; pageSize ≤ 100) | 401, 403, 404 `configuration`, 422 query |
| `GET /api/admin/configuration/:kind/revisions/:revisionId` | `config.read_revisions` | 200 `ConfigurationRevisionDetail` | 401, 403, 404 `configuration` (unknown kind; malformed, unknown or other-kind revision) |
| `GET /api/admin/configuration/:kind/draft` | `config.read_revisions` | 200 `{ draft: ConfigurationDraftDetail \| null }` | 401, 403, 404 |
| `PUT /api/admin/configuration/:kind/draft` | `config.publish` | 200 `ConfigurationDraftDetail` | 404; 409 `configuration_changed`; 422 (body not an object, over 64 KiB, base revision not of this kind, blank change note, schema) |
| `DELETE /api/admin/configuration/:kind/draft` | `config.publish` | 204 | 404; 409 |
| `POST /api/admin/configuration/:kind/draft/publish` | `config.publish` | 201 `ConfigurationRevisionSummary` | 404; 409; 422 with every problem |
| `POST /api/admin/configuration/:kind/revisions/:revisionId/restore` | `config.publish` | 201 `ConfigurationRevisionSummary` with `restoresRevisionNumber` | 404; 409; 422 `error.invalid_input.restore_current` or problems |

- **Authorization first.** Every route declares its action with target `none`; the W0-05 middleware answers 401/403 before the handler, so a non-Admin gets 403 `forbidden` (`authz.denied` reason `role`) on every route, also for a kind that does not exist (no existence oracle; T40).
- **Current revision.** "Current" and `inForce` mean the kind's latest published revision, the same revision the store's optimistic checks compare (`latestRevision`); under the `after_publish` rule it is in force for every event after its publish instant.
- **`frozenOnVersionCount`** counts `pack_version` rows whose `frozen_configuration ->> kind` equals the revision ID.
- **Display names** come from the existing subject directory (`publishedByDisplayName`, `updatedByDisplayName`); absent when unknown; `system` (seed) has none.
- **`editable`** is true when the kind has a registered body schema (`CONFIGURATION_BODY_SCHEMAS`); `group_role_mapping` stays false until W6-11. `valuesOwner` is `CONFIGURATION_VALUES_OWNER`.
- **Draft problems** are `publishProblems(kind, body, inForce, MAIL_MODE)` with the latest `checklist_templates` and `qc_rules` bodies; `problemCount` is their number. A draft is saved whatever its problems (Q18).
- **Writes** run in one `withTransaction` each with the app clock as `at`, the Admin's subject and role, the request correlation ID and the configured `MAIL_MODE` (absent in the in-process test harness, which the store treats as a sink).

## Error mapping

| Store error | Response |
|---|---|
| unknown kind (route check) | 404 `not_found` `{ resource: 'configuration' }` |
| `ConfigurationRevisionNotFound` / revision of another kind | 404 `configuration` |
| `ConfigurationChanged` | 409 `stale_version` `{ reason: 'configuration_changed', guidanceKey: 'error.stale_version.guidance.configuration_changed', current: { kind, revisionId, draftVersion }, refreshPath: '/admin/configuration/<kind>' }` |
| `ConfigurationDraftRejected` | 422: `not_an_object` → `body.body` `validation.configuration.draft_not_object`; `too_large` → `body.body` `validation.configuration.draft_too_large`; `base_revision_unknown` → `body.baseRevisionId` `validation.configuration.base_revision_unknown` |
| `ConfigurationChangeNoteInvalid` | 422 `body.changeNote` `validation.configuration.change_note_required` |
| `ConfigurationRestoreCurrent` | 422 `params.revisionId` `error.invalid_input.restore_current` |
| `ConfigurationBodyInvalid` | 422, one field per problem: the problem's JSON pointer into the configuration body as `path`, `validation.configuration.<code>` for a W6-03 code, `validation.configuration.schema` for a schema problem, `validation.configuration.not_editable` for a kind without a schema. Never the problem's prose (it may name values) |

The same pointer and key form is used for the draft's `problems`. New locale keys (th and en): `validation.configuration.{schema,not_editable,draft_not_object,draft_too_large,base_revision_unknown,change_note_required}`, the seven `validation.configuration.<PUBLISH_PROBLEM_CODES>` and `error.invalid_input.restore_current`.

## Logs and audit (W6 plan section 10; W0-10 amended)

- `configuration.published` (info) `{ kind, revisionId, revisionNumber, restoresRevisionId? }` after a publish or restore commits.
- `configuration.publish_refused` (warn) `{ kind, reason: 'stale' | 'invalid', problemCount }` when a publish or restore is refused with 409 (`stale`, count 0) or 422 (`invalid`). A 404 is not a refusal line.
- No body value, address or change note is logged. Audit rows are the store's: `configuration.draft_saved`, `configuration.draft_discarded`, `configuration.published` (with `restores_configuration_revision_id` on a restore); a refused write leaves none.

## Spec amendments

- W0-02 section 7.9 "no configuration write (W6)" annotated (dated) with the served routes.
- W0-10 section 3.3 registers the two events; a dated amendment note is appended.
