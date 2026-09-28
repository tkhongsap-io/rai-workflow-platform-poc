# Spec: Admin UI, simple-kind editors, draft and publish (W6-06, #249)

Source: W6 plan sections 1.2 (Q1 draft model, Q4 single-Admin publish with a required note, Q5 optimistic checks and the 409 reload, Q16 kind-specific forms, Q18 a draft saves any object and only publish refuses), 2.1 (kinds and their fail-closed rules), 2.3 (drafts, publish, stale drafts: "discard draft" or "start again from current"), 2.4 (the problems publish refuses), 4.2 (routes, served by W6-04), 9 (screens, locale keys, accessibility) and row W6-06. The plan wins over issue #249.

## Simple kinds

`sla`, `calendar`, `use_case_groups`, `operator_recipients`, `checklist_templates`. Every other kind keeps W6-05's "editing is not on this page yet" line (W6-07, W6-11, W6-12, W6-17).

## Form model (`screens/admin/editors/simple-kinds.ts`, pure)

- `isSimpleKind(kind)`.
- `formOf(kind, body)` reads a body leniently into form values (a draft may be half-finished): SLA lane values as text (a number or a string as it is, anything else empty); list items and holidays as the string entries of the kind's array (`groups`, `addresses`, `versions`, `holidays`).
- `bodyOf(form, base)` writes the form back over the base body, keeping any other key of the base: SLA values trimmed, a whole number becomes a number and anything else stays text (so the server's schema problem names it); list items and holidays trimmed, empty rows dropped; the calendar's `timezone` is always the literal `Asia/Bangkok` (D06).
- `problemTarget(kind, path)`: which field a served problem pointer names (an SLA lane, a list row by index, or the whole form), for `aria-invalid` and the problem's label.

## Editors (`screens/admin/editors/`)

- `sla-editor.tsx`: three number fields labelled by lane (`lane.dpo`, `lane.ai_coe`, `lane.it_security`), 1-60 working days as a hint, not enforced by the browser (Q18).
- `calendar-editor.tsx`: the fixed time zone as text, one date field per holiday with Remove, and "Add holiday".
- `list-editor.tsx`: one text field per item with Remove, and Add; used for use-case groups and checklist template versions (with the hint "publish the QC rules for a new version first", plan 2.4).
- `recipients-editor.tsx`: the list editor with e-mail fields and the hint that only `.example` or `.test` addresses are accepted while mail stays in the sink.
- Add moves focus to the new field; Remove moves focus to the next field, or to Add.
- `draft-editor.tsx`: the form of the kind, started from the draft (when there is one) or from the revision in force, and the actions:
  - **Save draft** (`PUT …/{kind}/draft`, base = the revision in force, `expectedDraftVersion` = the draft's or `null`): enabled when the form differs from the saved draft (or from the revision in force when there is no draft). On 200 a status says "Draft saved" and the page's draft facts update.
  - **Problems**: the draft's `problems` as a list, each with its field (lane, row number, or "this configuration") and its `validation.configuration.*` message; the fields named are `aria-invalid`. None: "No problems: this draft can be published".
  - **Publish** opens the publish dialog; enabled when a draft is saved, unchanged since, started from the revision in force and without problems (otherwise a hint says why).
  - **Discard draft** (`DELETE …/{kind}/draft`) after a confirmation dialog.
  - **Stale draft** (its base is not the revision in force): the form is read-only and the page offers "Start again from the revision in force" (a `PUT` of the current body, base = current, over the draft's version) and "Discard draft".
  - Any 409 shows `ErrorNotice` (the `configuration_changed` guidance) with Reload, which reloads the page's data and restarts the form from it; a 422 shows its field list.
- `publish-dialog.tsx` (on `components/dialog.tsx`): what publishing does, the after-publish sentence (`admin.config.applies_note`), a required change note (1-500 characters, counter; prefilled with the draft's note), Cancel and Publish. An empty note is refused in the dialog with no request. It sends `expectedDraftVersion` and `expectedCurrentRevisionId` as the page showed them and the note. On 201 the dialog closes, the page reloads and a focused status says "Published as revision N". 409: guidance and Reload; 422: the field list.

## Data (`api/client.ts`)

- `saveConfigurationDraft(kind, body)` → `PUT …/{kind}/draft`, 200 checked against `ConfigurationDraftDetailSchema`.
- `discardConfigurationDraft(kind, { expectedDraftVersion })` → `DELETE …/{kind}/draft`, 204.
- `publishConfigurationDraft(kind, { expectedDraftVersion, expectedCurrentRevisionId, changeNote })` → `POST …/{kind}/draft/publish`, 201 checked against `ConfigurationRevisionSummarySchema`.

## Locale keys

One contiguous `admin.config.editor.*` and `admin.config.publish_dialog.*` block in th and en (`locales.test.ts` parity); the existing `admin.config.draft.editing_later` stays for the kinds without an editor.

## Tests

- Unit `editors/simple-kinds.test.ts`: `formOf`/`bodyOf` per kind (lenient read, base keys kept, number conversion, empty rows dropped, the fixed time zone), `problemTarget`.
- Unit `api/client.test.ts`: paths, methods, bodies and response checks of the three writes.
- Browser `tests/browser/w6-06-admin-edit-publish.spec.ts` (real server, 1440/834/390): SLA DPO 0 saved as a draft shows the `/dpo` problem and blocks Publish; DPO 4 saved, published with a note (an empty note refused in the dialog), revision 2 in force with the note and body; the checklist template list with a version not in the QC catalogue shows `template_not_in_catalogue`; a recipient on a real domain shows `recipient_not_synthetic`; calendar and use-case groups edited and published; a draft moved by another write gives the 409 guidance, and Reload shows the moved draft; a stale draft is started again from the revision in force; th and en; axe; no sideways scroll; keyboard only (edit, save, publish dialog, focus on the published status).
