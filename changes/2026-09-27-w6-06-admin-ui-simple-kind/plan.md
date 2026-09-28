# Plan: Admin UI, simple-kind editors, draft and publish (W6-06, #249)

Recorded before code. Branch `codex/w6-06-admin-ui-simple-kind`, lane admin, database `rai-admin` on 55384.

1. Board CLAIM on Lane B (done before code).
2. Tests first (watch them fail):
   - `web/src/screens/admin/editors/simple-kinds.test.ts`.
   - `web/src/api/client.test.ts`: the three draft writes.
   - `tests/browser/w6-06-admin-edit-publish.spec.ts`.
3. Implement: `api/client.ts` (three writes), `screens/admin/editors/{simple-kinds.ts,sla-editor,calendar-editor,list-editor,recipients-editor,draft-editor}.tsx`, `screens/admin/publish-dialog.tsx`, `configuration-kind.tsx` (the draft section hosts the editor for simple kinds), `admin.css`, locales th/en.
4. Docs: DEVLOG, CHANGELOG. No contract change (W6-04 routes used as served), so no spec amendment.
5. Full gate (plan section 12), review.md, commit, push, verify remote head, PR "Refs #249".
