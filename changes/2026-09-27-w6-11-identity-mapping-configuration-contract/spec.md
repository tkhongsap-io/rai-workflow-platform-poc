# Spec: identity-mapping configuration contract (W6-11, #255)

Source: [W6 plan](../../docs/engineering/implementation-plan-w6.md) section 6 and row W6-11 (the plan wins over #255); section 3 (`UNSEEDED_KINDS`, W6-02); [identity adapter](../../docs/engineering/identity-adapter.md) 5 (S12) and 9.2.

## Shared schema

- `shared/src/schemas/identity-mapping.ts` exports `GroupRoleMappingSchema` (unchanged shape: `kind: 'identity.group_role_mapping'`, `version: 1`, `tenantId` non-empty, `rules[]` of the three rule shapes), `GroupRoleMapping` and `isGroupRoleMapping`.
- `server/src/identity/group-mapping.ts` re-exports all three; the resolver and the overage check stay there. `adapter.ts` and its tests are unchanged.
- `shared/src/schemas/cases.ts`: `CONFIGURATION_BODY_SCHEMAS.group_role_mapping = GroupRoleMappingSchema` and `ConfigurationBodies.group_role_mapping = GroupRoleMapping`. `seed.ts` is unchanged: `ConfigurationSeed` already excludes `UNSEEDED_KINDS`.

## Behaviour

- `validateConfigurationBody('group_role_mapping', body)` checks the schema; `publishProblems` has no cross-kind check for this kind. A synthetic body (all-zero tenant `00000000-0000-0000-0000-000000000000`, `fx-group-*` IDs) gives no problems; an invalid one gives schema problems.
- Every registered kind now has a schema, so the Admin index serves `editable: true` for `group_role_mapping` and the kind page offers restore.
- Start-up is unchanged: the adapter reads the revision in force once at start in `network`/`ad` and `production`, validates it, and refuses a body for another tenant (S12).

## UI

- `web/src/screens/admin/editors/json-editor.tsx`: a labelled monospace text area holding the body as indented JSON, a kind hint, and for `group_role_mapping` a warning (`admin.config.editor.identity_mapping_warning`). Text that is not a JSON object is refused in the page (`admin.config.editor.json_invalid`, `aria-invalid`) and never sent. Save, problems, publish, discard and restart are the W6-06 `DraftEditor` flow; schema problems are listed by their served pointer.
- `editors/json-kinds.ts` (pure): `JSON_KINDS = ['group_role_mapping']`, `isJsonKind`, `jsonTextOf(body)`, `parseJsonBody(text)`. W6-12 adds `risk_rubric`.
- Keys (th and en): `admin.config.editor.json_label`, `admin.config.editor.json_hint`, `admin.config.editor.json_invalid`, `admin.config.editor.identity_mapping_warning`.

## Tests

- `server/src/configuration/validate.test.ts`: a synthetic mapping passes `publishProblems` under both sink modes; invalid mappings (missing tenant, unknown role, a `bu_spoc` rule without `businessUnit`, wrong literal) are refused with schema problems only.
- `shared/src/schemas/identity-mapping.test.ts`: the registry entry is the moved schema; the server re-export is the same object.
- `web/src/screens/admin/editors/json-kinds.test.ts`: text round trip, parse refusals.
- `tests/browser/w6-11-identity-mapping-editor.spec.ts`: warning shown; invalid JSON refused in the page; a schema-invalid body saved lists problems; a synthetic body publishes revision 1; th/en, axe, three widths.
- Existing expectations that encoded "no schema until W6-11" change (listed in review.md).
