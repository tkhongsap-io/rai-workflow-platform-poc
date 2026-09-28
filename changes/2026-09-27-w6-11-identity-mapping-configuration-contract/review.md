# Review: identity-mapping configuration contract (W6-11, #255)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W6 plan](../../docs/engineering/implementation-plan-w6.md) sections 3, 6 and 11.2, row W6-11 (the plan wins over issue #255). Decisions implemented: register rows "Ta's delegation (2026-09-27)" and "W6 delegated rulings (provisional)". D10 stays open: no real tenant or group ID anywhere; the kind is still unseeded. Synthetic data only; no network call, no model, no deploy. No migration.

## Change

- **Shared schema** `shared/src/schemas/identity-mapping.ts`: `GroupRoleMappingSchema`, `GroupRoleMapping` and `isGroupRoleMapping`, moved unchanged from `server/src/identity/group-mapping.ts`, which now re-exports all three (the resolver and the overage check stay there; `adapter.ts` and `adapter.test.ts` are untouched).
- **Registration** `shared/src/schemas/cases.ts`: `CONFIGURATION_BODY_SCHEMAS.group_role_mapping` and `ConfigurationBodies.group_role_mapping`. `seed.ts` is unchanged: `ConfigurationSeed` already excludes `UNSEEDED_KINDS` (W6-02), and the seed and fixtures still publish no mapping. The Admin index now serves `editable: true` for the kind, and restore is offered on its page.
- **`store.ts`**: two `input.kind as SeedableConfigurationKind` casts removed; with every kind registered, `SeedableConfigurationKind` equals `ConfigurationKind` and `@typescript-eslint/no-unnecessary-type-assertion` refused the casts. No behaviour change.
- **JSON editor** `web/src/screens/admin/editors/json-editor.tsx` over pure `editors/json-kinds.ts` (`JSON_KINDS = ['group_role_mapping']`, `isJsonKind`, `jsonTextOf`, `parseJsonBody`). A labelled monospace text area with the whole body as indented JSON; above it the warning `admin.config.editor.identity_mapping_warning` (read only at start, only for `network`/`ad` and `production`; ignored by `fixture`, `local-google` and the `network` allow-list; no redeploy, but a restart to apply; synthetic values only, real ones D10). Text that is not a JSON object is refused in the page (`admin.config.editor.json_invalid`, `role="alert"`, `aria-invalid`) and never sent. `DraftEditor` (W6-06) hosts it, so save, problems, publish with a change note, discard, 409 and "start again" are the same flow; a JSON kind's problem is labelled by its served pointer (`/rules`), or "This configuration" at `/`. `configuration-kind.tsx` shows the editor for JSON kinds; `admin.css` styles the text area.
- **Locales**: `admin.config.editor.{identity_mapping_warning,json_hint,json_invalid,json_label}` in th and en.
- **Docs**: [identity adapter](../../docs/engineering/identity-adapter.md) 9.2 dated amendment (kind name, body literal, start-only read, restart not redeploy, BU list check not implemented, real values D10/W8).
- **Tests**:
  - `server/src/configuration/validate.test.ts` (+3): the server path re-exports the shared schema object and the kind stays in `UNSEEDED_KINDS` and out of the seed; a synthetic mapping (all-zero tenant, `fx-group-*`, every role) has no `publishProblems` under both sink modes with and without revisions in force, and an empty rule list is accepted; invalid mappings (wrong literal, wrong version, empty tenant, unknown role, `bu_spoc` without `businessUnit`, missing tenant) are refused with schema problems at their pointer and never a coded problem.
  - `shared/src/schemas/identity-mapping.test.ts` (2): the registry entry is the moved schema; valid and invalid shapes.
  - `web/src/screens/admin/editors/json-kinds.test.ts` (3): the JSON kind set, text of a body, only a JSON object parses.
  - `tests/browser/w6-11-identity-mapping-editor.spec.ts` (2 tests × 1440/834/390, real server): (1) the index no longer says "not editable"; the kind page shows the warning and hint, an empty `{}` field and Publish disabled; `{"kind":` and `[1, 2]` are refused in the page with no draft created; a body with role `superuser` saves as a draft and lists a `/rules` schema problem, marks the field invalid and blocks Publish, with no revision; the synthetic mapping saves with no problems, the warning shows in English, and publishing with a note makes revision 1 whose API body equals the mapping; axe (th, en), no sideways scroll. (2) Keyboard only: Tab to the field (visible focus), replace the text, Tab to Save, Enter; the draft body equals the mapping.
  - Red first: `validate.test.ts` and `identity-mapping.test.ts` failed with the shared module missing (`unit-red-1-module-missing.log`), then, with the schema moved but not registered, 4 tests failed on the registration assertions (`unit-red-2-unregistered.log`); `json-kinds.test.ts` failed with `ERR_MODULE_NOT_FOUND` (`unit-red-3-json-kinds.log`); the browser spec failed at 1440 before the editor existed, both tests (no warning, no field; `browser-red.log`).

## Expectations changed (behaviour changed by the plan)

Each asserted "`group_role_mapping` has no body schema until W6-11"; the plan makes W6-11 register it.

- `server/src/configuration/validate.test.ts` "the schema runs first": the empty mapping body now gets schema problems (asserted non-empty and not "no body schema registered") instead of the no-schema problem. No registered kind is left without a schema, so the no-schema branch of `validateConfigurationBody` has no product kind to exercise; it stays in the code as deny-by-default for a future kind.
- `server/src/configuration/seed.test.ts` (one line): `validateConfigurationBody('group_role_mapping', {})` now throws `ConfigurationBodyInvalid` rather than `/no body schema registered/`. The W6-02 assertions on `UNSEEDED_KINDS` and the mapping's absence from the seed are unchanged and green.
- `tests/integration/w1-00-configuration.test.ts`: `publishRevision` of `{}` for the kind is refused with `ConfigurationBodyInvalid` rather than the no-schema message.
- `tests/integration/w6-04-admin-configuration.test.ts`: the index entry is `editable: true`.
- `tests/integration/w6-02-configuration-drafts.test.ts`: comment only; the invalid body is still drafted and still refused on publish with `ConfigurationBodyInvalid`.

## Deviations

Choices under Ta's delegation of 2026-09-27 where the plan is silent or cannot be met as written.

- **`seed.test.ts` changed by one line**, although the row says it "stays green unchanged": its W6-02 assertion that the kind has no schema cannot hold once the kind is registered. The seed's own assertions (seeded set, the mapping's absence) are untouched.
- **Files beyond the row's list**: `editors/json-kinds.ts` and its test (pure model, as W6-06's `simple-kinds.ts`), `editors/draft-editor.tsx` and `configuration-kind.tsx` (the JSON editor reuses the W6-06 draft flow instead of copying it), `admin.css`, the locales, `shared/src/schemas/identity-mapping.test.ts`, the browser spec, `store.ts` (lint-forced cast removal) and the four test files above.
- **No publish-time check of `businessUnit` against a BU list**: section 9.2 describes one, but no BU value-list kind exists and the plan says the schema is unchanged. Recorded in the 9.2 amendment as left to W8 with the real values.
- **Problems are labelled by pointer**: the server keeps only a schema problem's first pointer segment (W6-04 `problemFields`), so the list names `/rules` rather than a rule index.
- **The stored body's key order is the database's** (`jsonb`), so after a publish the field shows the same mapping with keys possibly reordered; the browser spec compares parsed JSON.
- **The in-memory API substitute is unchanged** (frozen for W6, plan 11.2).

## Gate

Run from `/tmp/rai-w6-11-identity-mapping-configuration-contract/rai-web` after `set -a; . ./.env; set +a`, one suite at a time, on the head rebased onto `origin/main` `0a35d9b` (W4-06d), against this lane's Postgres (`POSTGRES_PORT=55384 docker compose -p rai-admin up -d --wait`; `.env` from `.env.example` with 54320 → 55384, `PORT=8831`, `PUBLIC_BASE_URL=http://127.0.0.1:8831`, `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8832`, `SUBSTITUTE_PORT=8833`, `SUBSTITUTE_WEB_PORT=5194`, `OBS_MIGRATION_ADMIN_URL` on 55384, `RAI_PG_TOOLS=docker-compose:rai-admin`; not committed). Logs in `/tmp/rai-w6-11-identity-mapping-configuration-contract-logs/`.

| Command | Result |
|---|---|
| `npm ci` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | 1282 tests, 1282 pass |
| `npm run test:integration` | 495 tests, 495 pass (a first run before `RAI_PG_TOOLS=docker-compose:rai-admin` was set failed only the 6 W7-01/W7-02 backup tests, which call `pg_dump` in this lane's container) |
| `npm run build && npm run check:substitute-absent` | exit 0 (1071 files scanned, 0 with the marker) |
| `npm run test:browser:server` | 262 passed (12.6 min), including 6 `w6-11-identity-mapping-editor` runs (2 tests × 3 widths) |
| `npm run test:browser:substitute` | 48 passed (41.0 s) |
| `node scripts/check-links.mjs` (repo root) | exit 0 (538 Markdown files, 1471 relative links, 0 broken) |
| `git diff --check` | exit 0 |
| red: unit files before the code | module missing, then 4 failed with the schema moved but unregistered, then `json-kinds` module missing |
| red: `w6-11-identity-mapping-editor` on desktop-1440 before the editor | 2 failed |

No browser test needed a retry. Hard-coded ports (8787 in some integration tests, 8789/5175 in `w1-int-substitute-absent`, 54370 in the performance launcher test) did not collide in this run.

## Process note

While stopping this lane's first full browser run (to rebase onto the new `main`), a `pkill -f` on the Playwright command line was used; its pattern was not scoped to this worktree, so a browser run of another lane on this machine at that moment may have been stopped too. It changes no files or databases; such a run needs to be started again.

## What this does not claim

No real tenant or group IDs (D10, W8); no apply-without-restart (W7/W8); no session revocation on a mapping change; no BU value-list check. The mapping is still read only at start; this ticket does not change the adapter. Values published in tests are synthetic. Access is enforced by the server (W6-04); the editor is presentation only, and every rule of what may be published is the server's.
