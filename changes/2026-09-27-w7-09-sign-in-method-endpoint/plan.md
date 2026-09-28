# Plan

1. Board CLAIM on `docs/board/lane-b-ui-notifications.md`. Change frame (this folder). No migration.
2. RED: `shared/src/schemas/auth.test.ts`, `server/src/identity/routes.test.ts`, `web/src/api/client.test.ts`, `web/src/screens/sign-in/sign-in.view-model.test.ts`, `tests/browser/w7-09-sign-in-method.spec.ts`; run each and watch it fail.
3. GREEN: `shared/src/schemas/auth.ts`; `server/src/identity/routes.ts`; `shared/src/locales/{en,th}.json`; `web/src/api/client.ts`; `web/src/screens/sign-in/sign-in.view-model.ts` and `sign-in-screen.tsx`.
4. Docs: W0-02 section 7.2 dated amendment.
5. Full gate one suite at a time, logs under `/tmp/rai-w7-09-sign-in-method-endpoint-logs/`.
6. review.md, DEVLOG, CHANGELOG; commit, push, verify the remote head, open the PR ("Refs #218").
