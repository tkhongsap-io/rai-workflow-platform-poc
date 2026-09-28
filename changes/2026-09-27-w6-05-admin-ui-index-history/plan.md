# Plan: Admin UI, index, history, diff and restore (W6-05, #241)

Recorded before code. Branch `codex/w6-05-admin-ui-index-history`, lane admin, database `rai-admin` on 55384.

1. Board CLAIM on Lane B (done before code).
2. Tests first (watch them fail):
   - `web/src/screens/admin/diff.test.ts` (module missing, then assertions).
   - `web/src/routes.test.ts`: admin routes.
   - `web/src/api/client.test.ts`: the five admin calls.
   - `tests/browser/w6-05-admin-configuration.spec.ts`.
3. Implement: `routes.ts`, `router.tsx`, `app-shell.tsx` (Configuration link for Admin), `api/client.ts`, `screens/admin/{configuration-index,configuration-kind,revision-diff,restore-dialog}.tsx`, `screens/admin/{diff.ts,admin.css,configuration.view-model.ts}`, locales th/en (`admin.config.*` block).
4. Docs: DEVLOG, CHANGELOG. No contract change (W6-04 routes used as served), so no spec amendment.
5. Full gate (plan section 12), review.md, commit, push, verify remote head, PR "Refs #241".
