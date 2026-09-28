# Review: Admin UI, index, history, diff and restore (W6-05, #241)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W6 plan](../../docs/engineering/implementation-plan-w6.md) sections 1.2 (Q3, Q16), 2.3, 4.2, 9 and 13, row W6-05 (the plan wins over issue #241). Decisions implemented: register rows "Ta's delegation (2026-09-27)" and "W6 delegated rulings (provisional)". D07-D10 stay open; their values are only badged. Synthetic data only; no network call, no model, no deploy. No migration, no server change.

## Change

- **Routes and navigation**: `ROUTES.adminConfiguration` (`/admin/configuration`), `adminConfigurationKind(kind)` (also the W6-04 `refreshPath` of a 409 `configuration_changed`) and `adminConfigurationRevision(kind, id)`, segments URL-encoded, all under `RequireSession` (`router.tsx`). "Configuration" (`admin.config.title`) sits beside "Desk health" when `isOperatorAdmin(session)` (`app-shell.tsx`, presentation only).
- **Client** `api/client.ts`: `getConfigurationIndex`, `listConfigurationRevisions(kind, { page, pageSize })`, `getConfigurationRevision`, `getConfigurationDraft`, `restoreConfigurationRevision(kind, id, { expectedCurrentRevisionId, changeNote })`. Every 2xx body is checked against its W6-01 schema through one `checked()` helper (`InvalidResponseError` otherwise); kinds and IDs are path-encoded.
- **Screens** `web/src/screens/admin/`:
  - `configuration-index.tsx`: one captioned table of every kind the server serves: name (link), values owner badge, revision in force (number and date) or "not published", "not editable yet" when `editable` is false, draft (none, or saved at with its problem count). `AdminLoadError` renders any failure through `ErrorNotice` (so a non-Admin sees the server's 403 and an unknown kind its 404), or `admin.config.invalid_response` for a schema refusal.
  - `configuration-kind.tsx`: owner badge, the after-publish sentence (`admin.config.applies_note`, plan 2.2), the revision in force with its facts (publisher, note or "seed revision, no change note", restored-from, versions that froze it) and its body in a keyboard-scrollable region; the draft section (based on revision N, or "started from an earlier revision" when its base is stale, problem count; editing is W6-06); the history table newest first (revision link, published, by, note, restores, versions frozen, "In force" or "Earlier" as words, Restore on every row but the one in force when the kind has a registered body schema); pages of 25; the compare form (from, to; two different revisions required) that opens the diff.
  - `revision-diff.tsx`: the revision's facts and body, "Restore" when it is not in force, and the diff against `?against=` (default `defaultAgainst`: the revision in force, else the previous one) as a captioned table (pointer, change as a word, before, after) or "no differences"; a "compare with" select rewrites `?against=`.
  - `restore-dialog.tsx` on `components/dialog.tsx`: title, what restore does, the after-publish sentence, a required change note (`changeNoteOf`: trimmed, 1-500 characters; refused in the dialog without a request), a character count, Cancel and Restore. It sends the revision in force the page showed. On 201 the page reloads its data without unmounting the table, and a status line says "Revision K restored as revision N"; focus returns to the Restore button. A 409 shows the `configuration_changed` guidance with a Reload button; a 422 shows its field list.
  - `diff.ts` (pure): `diffBodies` by RFC 6901 pointer (objects by sorted key, arrays by index, a type change as one entry), `pointerSegment`, `formatDiffValue`, `defaultAgainst`. `configuration.view-model.ts`: `kindLabelKey`, `ownerLabelKey`, `isConfigurationKind`, `changeNoteOf`. `admin.css`: tables and bodies scroll inside their own region.
- **Locales**: 83 `admin.config.*` keys in one contiguous block in th and en; pagination reuses `cases.prev_page`, `cases.next_page`, `cases.page_of`.
- **Tests**:
  - `web/src/screens/admin/diff.test.ts` (7 tests): equal bodies, added/removed/changed leaves in sorted order, nested objects and arrays by index, type changes as one entry, pointer escaping, value rendering, the default comparison.
  - `web/src/screens/admin/configuration.view-model.test.ts` (2 tests): every kind and owner has a catalogue key, `lane_mapping` and `toString` are not kinds, the note rule.
  - `web/src/routes.test.ts` (1 test) and `web/src/api/client.test.ts` (3 tests): paths, methods, encoding, the restore body, schema refusals and a 403 kept as `ApiError`.
  - `tests/browser/w6-05-admin-configuration.spec.ts` (3 tests × 1440/834/390, real server): (1) after an owner submit (freezing SLA revision 1) and an Admin API publish of SLA revision 2 with a note, the Admin reaches Configuration from the navigation; every kind's row equals `GET /api/admin/configuration` (name, owner badge incl. D07 and D10, revision in force); the SLA history is newest first with the notes and version counts the API serves (revision 1 frozen by 1 version); the revision in force has no Restore; compare 1 → 2 lands on the revision URL with `?against=` and shows exactly `/dpo` changed 3 → 4; English; restore of revision 1: an empty note is refused in the dialog with no request, then a note publishes revision 3 "restores revision 1", in force, whose body the API serves as the seed; axe th and en on index, kind, diff and dialog; no sideways scroll. (2) The DPO reviewer and the CM owner have no Configuration link, and the index, a kind page and a revision page each show the 403 notice with no table; axe; the Admin opening `/admin/configuration/lane_mapping` sees the 404 notice. (3) Keyboard only: Tab to the SLA link, Enter, focus on main, Tab to Restore on revision 1, Enter, focus in the note, type, Tab to Restore, Enter, dialog closes, success status, focus back on the Restore button with a visible ring.
  - Red first: the unit files failed before the code (`ERR_MODULE_NOT_FOUND` for `diff.js`; `getConfigurationIndex`/`restoreConfigurationRevision` not functions; `ROUTES.adminConfiguration` undefined; log `unit-red.log`), and the browser spec could not run (the web build's `tsc -b` failed on the missing module; `browser-red.log`). `configuration.view-model.test.ts` was written in the same step as its module, so it was not seen red; the browser spec bites: a mutation rendering every history version count as 0 failed test (1) at 1440 (`toHaveText` on the `versions` cell) and was reverted.

## Deviations

Choices under Ta's delegation of 2026-09-27 where the plan is silent or cannot be met as written; each keeps the W6-01 shapes and the W6-04 routes as served.

- **Owner badge keys are lower-case**: `admin.config.values_owner.d07`, `.d09`, `.d10` (and `.admin`), not the plan's `admin.config.values_owner.D07`. `shared/src/locales/locales.test.ts` requires every key to match `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`; the visible text is still "Provisional until D07". W6-07 (the D09 per-param badge) and W6-12 should use the same keys.
- **A view model file outside the row's list**: `screens/admin/configuration.view-model.ts` (and its test) and `screens/admin/admin.css`, following the dashboard's pattern; `web/src/api/client.test.ts` and `web/src/routes.test.ts` gain the tests for the row's `api/client.ts` and `routes.ts`.
- **Restore is offered only when the kind has a registered body schema** (the index's `editable`); `group_role_mapping` has none until W6-11 and no revision, so it shows "not editable yet" and "not published". The server still validates every restore (W6-03).
- **Diff direction**: the revision page shows the change from `?against=` to the revision in the path. From the kind page's compare form "from" is `against` and "to" is the page's revision. With the default (the revision in force), an older revision's page therefore shows what restoring it would change.
- **The compare selects list the history page shown** (25 newest by default; the revision page's "compare with" lists up to the API's page maximum of 100). A kind with more revisions pages through them; nothing is hidden, but a pair spanning two pages is compared from the revision page.
- **Draft editing is not on these pages**: the draft section shows the W6-04 draft summary and says editing is not on this page yet. W6-06 adds the editors, publish dialog and discard; the plan's "discard draft / start again" choice after a restore makes the draft stale is W6-06's (this page labels the stale base).
- **The in-memory API substitute is unchanged** (frozen for W6, plan 11.2); no substitute journey opens the Admin pages.

## Gate

Run from `/tmp/rai-w6-05-admin-ui-index-history/rai-web` after `set -a; . ./.env; set +a`, one suite at a time, against this lane's Postgres (`POSTGRES_PORT=55384 docker compose -p rai-admin up -d --wait`; `.env` from `.env.example` with 54320 → 55384, `PORT=8831`, `PUBLIC_BASE_URL=http://127.0.0.1:8831`, `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8832`, `SUBSTITUTE_PORT=8833`, `SUBSTITUTE_WEB_PORT=5194`, `OBS_MIGRATION_ADMIN_URL` on 55384, `RAI_PG_TOOLS=docker-compose:rai-admin`; not committed). Logs in `/tmp/rai-w6-05-admin-ui-index-history-logs/`. Hard-coded ports (8787 in some integration tests, 8789/5175 in `w1-int-substitute-absent`, 54370 in the performance launcher test) did not collide in this run; no retry was needed.

| Command | Result |
|---|---|
| `npm ci` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | 1144 tests, 1144 pass |
| `npm run test:integration` | 478 tests, 478 pass. A first run failed the six W7-01/W7-02 backup tests with `pg_tools_container_not_found` because `.env` still named `RAI_PG_TOOLS=docker-compose:rai-dev`; set to this lane's `rai-admin` (environment only), then all pass |
| `npm run build && npm run check:substitute-absent` | exit 0 (1003 files scanned, 0 with the marker) |
| `npm run test:browser:server` | 241 passed (9.9 min), including 9 `w6-05-admin-configuration` runs (3 tests × 3 widths) |
| `npm run test:browser:substitute` | 48 passed (33.0 s) |
| `node scripts/check-links.mjs` (repo root) | exit 0 (497 Markdown files, 1368 relative links, 0 broken) |
| `git diff --check` | exit 0 (new files intent-to-add) |
| mutation: history version count rendered as 0, `w6-05-admin-configuration` on desktop-1440 | 1 failed (test 1), 2 passed; reverted |

## What this does not claim

No draft editing, publishing or discarding (W6-06), no QC rule editor (W6-07), no JSON editors (W6-11, W6-12), no desk-controls switches (W6-17). The values badged D07, D09 and D10 remain those owners' decisions; nothing here claims an owner approved anything. Access is enforced by the server (W6-04, T40); the navigation link is presentation only.
