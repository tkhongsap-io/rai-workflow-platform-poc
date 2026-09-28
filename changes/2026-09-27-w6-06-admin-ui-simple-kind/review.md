# Review: Admin UI, simple-kind editors, draft and publish (W6-06, #249)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W6 plan](../../docs/engineering/implementation-plan-w6.md) sections 1.2 (Q1, Q4, Q5, Q16, Q18), 2.1 to 2.4, 4.2, 9 and 13, row W6-06 (the plan wins over issue #249). Decisions implemented: register rows "Ta's delegation (2026-09-27)" and "W6 delegated rulings (provisional)". D07-D10 stay open; no value they own is edited here. Synthetic data only; no network call, no model, no deploy. No migration, no server change.

## Change

- **Client** `api/client.ts`: `saveConfigurationDraft(kind, { baseRevisionId, expectedDraftVersion, body, changeNote? })` (`PUT …/{kind}/draft`, 200 checked against `ConfigurationDraftDetailSchema`), `discardConfigurationDraft(kind, { expectedDraftVersion })` (`DELETE`, 204) and `publishConfigurationDraft(kind, { expectedDraftVersion, expectedCurrentRevisionId, changeNote })` (`POST …/draft/publish`, 201 checked against `ConfigurationRevisionSummarySchema`). Kinds are path-encoded; a 409 stays an `ApiError`.
- **Form model** `screens/admin/editors/simple-kinds.ts` (pure): `SIMPLE_KINDS` (`sla`, `calendar`, `use_case_groups`, `operator_recipients`, `checklist_templates`), `formOf` (lenient read of a possibly half-finished body), `bodyOf` (write-back over the base body keeping its other keys; a whole SLA number becomes a number and anything else stays text for the server to name; list rows trimmed and empty rows dropped; the calendar's `timezone` is always `Asia/Bangkok`, D06), `problemTarget` (a served pointer → SLA lane, list row, or the whole form).
- **Editors** `screens/admin/editors/`: `sla-editor.tsx` (three number fields labelled by lane, the 1-60 range as a hint only, Q18), `list-editor.tsx` (a field per entry with Remove, and Add; Add focuses the new field, Remove the next field or Add), `calendar-editor.tsx` (the fixed time zone as text, date fields), `recipients-editor.tsx` (e-mail fields, the `.example`/`.test` rule stated), and `draft-editor.tsx`: the form starts from the draft or the revision in force and restarts whenever the page's data changes; Save draft sends the revision in force as base and the draft's version; the served `problems` are listed under "Problems publishing would refuse" by field and message, and the fields they name are `aria-invalid` and described by the list; Publish is enabled only for a saved, unchanged, current, problem-free draft (a hint says why otherwise); Discard asks in a dialog; a stale draft (base not in force) is read-only with "Start again from the revision in force" (a `PUT` of the current body over the draft's version) and Discard; a 409 shows the `configuration_changed` guidance with Reload.
- **Publish dialog** `screens/admin/publish-dialog.tsx` on `components/dialog.tsx`: title with the kind's name, what publishing does, the after-publish sentence, a required change note (1-500 characters, counter, prefilled with the draft's note; refused in the dialog with no request), Cancel and "Publish now". On 201 the page reloads and a focused status says "Published as revision N"; 409 guidance with Reload; 422 field list.
- **Kind page** `configuration-kind.tsx`: the Draft section hosts the editor for the five simple kinds; every other kind keeps W6-05's "not on this page yet" line. Published and discarded outcomes are page-level statuses that take focus (the control that asked for them goes away).
- **Locales**: 44 keys in one contiguous `admin.config.{discard_dialog,editor,publish_dialog}.*` block in th and en.
- **Tests**:
  - `web/src/screens/admin/editors/simple-kinds.test.ts` (6 tests): the simple-kind set, SLA read and write-back, lists, calendar, round trip of every seeded body, problem targets.
  - `web/src/api/client.test.ts` (2 tests): paths, methods, encoding and bodies of the three writes, schema refusals, a 409 kept as `ApiError`.
  - `tests/browser/w6-06-admin-edit-publish.spec.ts` (4 tests × 1440/834/390, real server): (1) SLA: Publish disabled with no draft; DPO 0 saved as a draft lists the `/dpo` problem with its lane and message, marks the field invalid, blocks Publish and counts 1 in the draft facts; DPO 4 saved shows "no problems"; in English an empty note is refused in the dialog with no revision published, then the note publishes revision 2, the focused status says so, the history row carries the note and "In force", the API serves the body and no draft. (2) Checklist templates: an added `v3.0` (focus lands on the new field) gives `template_not_in_catalogue` at `/versions/2`, and the draft is discarded through the dialog; operator recipients: a `.com` address gives `recipient_not_synthetic` at `/addresses/1`; calendar: a holiday added and published (API body checked, `Asia/Bangkok` kept); use-case groups: the last group removed, a new one added and published. (3) A draft moved by another write: Publish gives the 409 guidance inside the dialog, nothing is published, Reload shows the moved value; then, after an API publish, a new draft and a restore, the page shows the draft as stale, read-only, Publish disabled, and "Start again" rebases it on revision 3 with its body (API checked). (4) Keyboard only: type in the DPO field, Save, Publish, the note field focused in the dialog, confirm, focus on the published status with a visible ring. Axe (no critical or serious violation) in th and en; no sideways scroll.
  - Red first: the unit files failed before the code (`ERR_MODULE_NOT_FOUND` for `simple-kinds.js`; `saveConfigurationDraft`/`discardConfigurationDraft` not functions; log `unit-red.log`). The browser spec was written before the screens and first run after them (all green), so it was then shown red against the kind page of `origin/main` (no editor): 4 failed on desktop-1440 (`browser-red.log`). Mutation: the SLA field no longer marked invalid by a served problem failed test (1) at 1440 on `aria-invalid` (`browser-mutation.log`), reverted.

## Deviations

Choices under Ta's delegation of 2026-09-27 where the plan is silent or cannot be met as written; each keeps the W6-01 shapes and the W6-04 routes as served.

- **Files beyond the row's list**: `editors/simple-kinds.ts` (pure form model, with its unit test) and `editors/draft-editor.tsx` (the save, problems, publish, discard and restart flow shared by the four editors), following W6-05's view-model pattern; `configuration-kind.tsx`, `admin.css`, `api/client.ts` and `client.test.ts` are touched to host and call them.
- **The templates list uses `list-editor.tsx`** with a hint that the QC catalogue entry comes first (plan 2.4); the use-case groups use it too. Recipients and the calendar wrap it (e-mail and date fields).
- **The draft's own change note is optional and not edited in the form**: the publish dialog asks for the note (required, prefilled with the draft's note when an API caller stored one). A save keeps a stored draft note.
- **Publish is offered only for a saved, unchanged, current and problem-free draft**, so the Admin fixes problems before the dialog; the server still refuses any publish (422 with fields, shown in the dialog) and any stale request (409).
- **Save draft is never disabled** (only guarded while a request runs), so focus stays on it after a save; an unchanged form saved again only moves the draft version.
- **A list row that is empty is dropped on save**, and a whole SLA number is sent as a number while any other text is sent as text, so the server's schema names it (Q18).
- **Problem labels**: a schema problem carries only its first pointer segment (W6-04 `problemFields`), so a list schema problem names the whole configuration, and a W6-03 problem (`/versions/2`, `/addresses/1`) names its row.
- **The in-memory API substitute is unchanged** (frozen for W6, plan 11.2); no substitute journey opens the Admin pages.

## Gate

Run from `/tmp/rai-w6-06-admin-ui-simple-kind/rai-web` after `set -a; . ./.env; set +a`, one suite at a time, against this lane's Postgres (`POSTGRES_PORT=55384 docker compose -p rai-admin up -d --wait`; `.env` from `.env.example` with 54320 → 55384, `PORT=8831`, `PUBLIC_BASE_URL=http://127.0.0.1:8831`, `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8832`, `SUBSTITUTE_PORT=8833`, `SUBSTITUTE_WEB_PORT=5194`, `OBS_MIGRATION_ADMIN_URL` on 55384, `RAI_PG_TOOLS=docker-compose:rai-admin`; not committed). Logs in `/tmp/rai-w6-06-admin-ui-simple-kind-logs/`. Hard-coded ports (8787 in some integration tests, 8789/5175 in `w1-int-substitute-absent`, 54370 in the performance launcher test) did not collide in this run; no retry was needed.

| Command | Result |
|---|---|
| `npm ci` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | 1216 tests, 1216 pass |
| `npm run test:integration` | 491 tests, 491 pass |
| `npm run build && npm run check:substitute-absent` | exit 0 (1043 files scanned, 0 with the marker) |
| `npm run test:browser:server` | 253 passed (10.6 min), including 12 `w6-06-admin-edit-publish` runs (4 tests × 3 widths) |
| `npm run test:browser:substitute` | 48 passed (32.1 s) |
| `node scripts/check-links.mjs` (repo root) | exit 0 (517 Markdown files, 1402 relative links, 0 broken) |
| `git diff --check` | exit 0 (new files intent-to-add) |
| red: `w6-06-admin-edit-publish` on desktop-1440 against `origin/main`'s `configuration-kind.tsx` | 4 failed; restored |
| mutation: problems do not mark the SLA field invalid, `w6-06-admin-edit-publish` on desktop-1440 | 1 failed (test 1), 3 passed; reverted |

## What this does not claim

No QC rule catalogue editor (W6-07), no JSON editors for the identity mapping or the risk rubric (W6-11, W6-12), no desk-controls switches (W6-17). Values published in the tests are synthetic. Access is enforced by the server (W6-04, T40); the editors are presentation only, and every rule of what may be published is the server's (W6-03).
