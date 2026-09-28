# Spec: Admin UI, index, history, diff and restore (W6-05, #241)

Source: W6 plan sections 1.2 (Q3 restore semantics, Q16 UI shape), 2.3 (restore, change note), 4.2 (routes and shapes, served by W6-04), 9 (routes, navigation, screens, locale keys, accessibility), 13 (unit `admin/diff.ts`; browser evidence) and row W6-05. The plan wins over issue #241.

## Routes and navigation

- `ROUTES.adminConfiguration = '/admin/configuration'`, `ROUTES.adminConfigurationKind(kind)` = `/admin/configuration/<kind>` (the W6-04 `refreshPath` of a 409 `configuration_changed`), `ROUTES.adminConfigurationRevision(kind, id)` = `/admin/configuration/<kind>/revisions/<id>`. All under `RequireSession`. A path parameter is URL-encoded.
- `app-shell.tsx`: "Configuration" (`admin.config.title`) beside "Desk health" when `isOperatorAdmin(session)`. Presentation only.
- The screens never decide access: each calls the Admin API and renders `ErrorNotice` for any failure, so a non-Admin sees the server's 403 (`error.forbidden`) and an unknown kind or revision the 404.

## Data (`api/client.ts`)

Every read checks the body against its W6-01 schema (`InvalidResponseError` otherwise, as `getDashboard`):
- `getConfigurationIndex()` → `GET /api/admin/configuration`.
- `listConfigurationRevisions(kind, { page, pageSize })` → `GET …/{kind}/revisions`.
- `getConfigurationRevision(kind, revisionId)` → `GET …/{kind}/revisions/{revisionId}`.
- `getConfigurationDraft(kind)` → `GET …/{kind}/draft`.
- `restoreConfigurationRevision(kind, revisionId, { expectedCurrentRevisionId, changeNote })` → `POST …/{kind}/revisions/{revisionId}/restore`, 201 checked against `ConfigurationRevisionSummarySchema`.
Kinds and IDs are path-encoded.

## Screens (`web/src/screens/admin/`)

- `configuration-index.tsx`: `h1` `admin.config.title`, a description, and one captioned table: kind (link to the kind page), values owner (badge `admin.config.values_owner.<owner>`: Admin, or "provisional until D07/D09/D10"), revision in force (number, published date and time) or "not published", draft (none, or saved with its problem count), and "not editable yet" when `editable` is false.
- `configuration-kind.tsx`: `h1` the kind's name, the owner badge, the after-publish rule sentence (`admin.config.applies_note`); **current** (revision number, published at and by, change note or "seed, no note", restored-from, versions that froze it) with its body in a scrollable `<pre>`; **draft** (none, or updated by and at, change note, problem count, "based on revision N" or "based on an older revision"; editing is W6-06); **history**: a captioned table newest first (revision, published, by, change note, restores, versions frozen, in force as a word) with "View" per row and "Restore" on every row but the one in force when the kind is editable; a **compare** form with two selects (from, to) that opens the diff. Pages of 25 with previous and next when `total` exceeds a page.
- `revision-diff.tsx` (the revision route): the revision's summary and body; a "compare with" select of the kind's other revisions (default: the revision in force when this is not it, else the previous one; `?against=<id>` in the URL); the diff as a captioned table (JSON path, change as a word, before, after) or "no differences"; "Restore this revision" when it is not in force and the kind is editable.
- `restore-dialog.tsx` (on `components/dialog.tsx`): the revision being restored, the after-publish sentence, a required change note textarea (1-500 characters, counter), Cancel and Restore. An empty or over-long note is refused in the dialog without a request. It sends `expectedCurrentRevisionId` = the revision in force the page shows. On 201 it closes, the page reloads its data and a status line says "Revision K restored as revision N". A 409 or 422 is shown with `ErrorNotice` inside the dialog (field list for 422; guidance and a Reload button for 409 that reloads the page data).
- `admin/diff.ts` (pure): `diffBodies(before, after)` → `Array<{ path, change: 'added' | 'removed' | 'changed', before?, after? }>` in JSON-pointer paths (RFC 6901 escaping), recursing into objects (keys in sorted order) and arrays (by index); a type change (object, array, scalar) is one `changed` entry at that path; equal bodies give `[]`. `formatDiffValue(value)` renders JSON text. `defaultAgainst(items, revisionId)` picks the default comparison revision.
- `admin/admin.css`: tables scroll inside their region at 390 px; the page never scrolls sideways.

## Locale keys

One contiguous `admin.config.*` block in th and en (`locales.test.ts` parity): titles, kind names (nine kinds), owner badges, table captions and headers, draft and current labels, diff labels and change words, compare form, restore dialog, success status, pagination.

## Tests

- Unit `web/src/screens/admin/diff.test.ts`: equal bodies; added, removed and changed leaves; nested objects; arrays by index and length change; type change; pointer escaping; sorted order; `defaultAgainst`.
- Unit `web/src/routes.test.ts`: the three admin routes, encoding, `safeReturnTo`.
- Unit `web/src/api/client.test.ts`: paths, methods, encoding and body of the five calls; schema-invalid reads rejected.
- Browser `tests/browser/w6-05-admin-configuration.spec.ts` (real server, 1440/834/390): Admin sees every kind of the index with its owner badge; after an API publish of a second `sla` revision with a note and a submit, the SLA history shows both revisions newest first with change notes and version counts equal to the API; the diff of 1 and 2 shows `/dpo` changed; restoring revision 1 with a note publishes revision 3 "restores 1", in force, with its note; an empty note is refused in the dialog; a non-Admin (reviewer and owner) opening the index and a kind page sees the 403 notice and has no Configuration link; th and en; keyboard (open the restore dialog, type the note, confirm, focus returns); axe with no critical or serious violation; no sideways scroll.
