# Specification

Source: the W6-01 row of the [W6 plan](../../docs/engineering/implementation-plan-w6.md) (section 11), with sections 4.1, 4.2, 4.3, 8.1, 8.2, 10 and 17. The plan wins over issue #206.

Done when:

1. **Admin configuration shapes** (`shared/src/schemas/configuration-admin.ts`, plan section 4.2), as TypeBox schemas with their static types, so W6-04's routes validate and serialize through them:
   - `ConfigurationRevisionSummary` `{ revisionId, kind, revisionNumber, publishedAt, publishedBy, publishedByDisplayName?, changeNote: string | null, restoresRevisionNumber: number | null, inForce, frozenOnVersionCount }` and `ConfigurationRevisionDetail` (summary plus `body`);
   - `ConfigurationDraftSummary` and `ConfigurationDraftDetail` (`body`, `problems: FieldError[]`);
   - the index `{ kinds: Array<{ kind, editable, valuesOwner: 'admin' | 'D07' | 'D09' | 'D10', current, draft }> }`, the revision list `{ items, total }` with its `page`/`pageSize` query, and `{ draft: … | null }`;
   - the request bodies: save draft `{ baseRevisionId, expectedDraftVersion, body, changeNote? }`, discard `{ expectedDraftVersion }`, publish `{ expectedDraftVersion, expectedCurrentRevisionId }`, restore `{ expectedCurrentRevisionId, changeNote }`;
   - the constants `CHANGE_NOTE_MAX_LENGTH = 500`, `CONFIGURATION_DRAFT_MAX_BYTES = 65536`, and `CONFIGURATION_VALUES_OWNER` (who owns each kind's values; exhaustive over `ConfigurationKind`);
   - route params are plain strings, so an unknown kind or a malformed revision ID can be answered 404 `configuration` (never a 422 from validation).
2. **Dashboard shape** (`shared/src/schemas/dashboard.ts`, plan section 8.1): `DashboardResponse` exactly as the plan's interface (`asOf`, `today`, `cases`, `lanes`, `findings`, `qc`, `risk`, `activity`), `byStatus` over every `CaseStatus`, `unavailableOpen` over every lane, `severity` limited to `high | medium | low`, `risk` either `{ available: false }` or the tier list. `DASHBOARD_ACTIVITY_WEEKS = 8`. `DASHBOARD_DUE_SOON_WORKING_DAYS = 2` in `shared/src/constants.ts` (Q14).
3. **Queue drill-down filters** (`shared/src/schemas/queue.ts`, plan section 8.2): `lane`, `laneStatus` (`pending | approved | sent_back`), `sla` (`due_soon | breached`), `findingLane`, `findingSeverity` (`high | medium | low`) and `findingKind` (`defect | unavailable`) are declared and validated. They are **not yet accepted by the served `QueueQuerySchema`** (see review.md, Deviations): W6-14 adds them to it in the same PR that applies them inside the scoped query.
4. **Version configuration read type** (plan section 4.3): `SubmittedVersion.frozenConfiguration?: Array<{ kind, revisionId, revisionNumber, label: string | null }>`, optional, with a `FrozenConfigurationEntrySchema` W6-09 can declare in the route schema. `submittedVersionView` still type-checks unchanged.
5. **Policy rows** (`server/src/authz/policy.ts`, plan section 4.1):
   - new action `qc.recheck`: Admin, `all_cases`, target `case`;
   - new action `dashboard.view`: the six `VIEW_ROLES`, target `none` (scope applied in SQL by `caseScopeWhere`);
   - `config.publish` and `config.read_revisions` stay Admin only; no other row changes; Admin still has no `lane.*` or `finding.*` row (T18).
   - Unit tests: the action set with rows; the table-driven role × action sweep over the new actions; `qc.recheck` Admin only (every reviewer role denied with reason `role`); `dashboard.view` for all six roles; T40 at the unit level (every non-Admin role denied `config.read_revisions`, `config.publish` and `qc.recheck` with reason `role`, including combined non-Admin roles).
6. **Error contract** (`shared/src/errors.ts`, plan section 4.2, W0-06 8.1 and 8.3):
   - new code `desk_frozen` → HTTP 503, with `DeskFrozenError` (no details: the banner reads readiness, W6-17);
   - `STALE_REASONS` gains `configuration_changed`; its details carry a configuration reference `{ kind, revisionId, draftVersion }` instead of a version reference;
   - `NotFoundResource` gains `configuration`;
   - `shared/src/errors.test.ts`: `EXPECTED_STATUS` gains `desk_frozen: 503`; the locale-key test covers `error.desk_frozen` and `error.stale_version.guidance.configuration_changed` in th and en; one test per new type.
7. **Error capture** (plan section 4.2, W0-10): `ErrorCategorySchema` and `SafeErrorFieldsSchema` gain `desk_frozen`; `levels.desk_frozen = 'info'`; `http()` maps `DeskFrozenError` to `{ category: 'desk_frozen' }`. `server/src/observability/errors.test.ts` proves a `DeskFrozenError` is captured as `desk_frozen`, HTTP 503, at info, with no stack, and counted under `desk_frozen`, never `internal_error`. A `NotFoundError('configuration')` is captured as `not_found` with `targetType: 'configuration'`.
8. **Labels and locales**: `operator.value.desk_frozen` in `OPERATOR_VALUE_KEYS` (exhaustive by `satisfies`; typecheck green); `error.desk_frozen`, `error.stale_version.guidance.configuration_changed`, `operator.value.desk_frozen` in th and en.
9. **Docs** (plan section 17): dated amendments to W0-02 (new section 7.10 "W6 shapes"), W0-05 (the `qc.recheck` and `dashboard.view` rows, `config.publish` now live, T40), W0-06 (8.1 `desk_frozen`, 8.3 `configuration_changed` and the `configuration` resource) and W0-10 (the `desk_frozen` error category at info).
10. Full plan section 12 gate green.
