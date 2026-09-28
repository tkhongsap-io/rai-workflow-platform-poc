# Plan: real, revocable artifact read handles (W4-05a, #211)

1. Board CLAIM in `docs/board/lane-a-workflow-server.md`; this frame before code.
2. RED tests:
   - `server/src/qc/artifact-handles.test.ts` (unit, real filesystem store in a temp dir plus a gated fake store): bytes streamed equal the stored bytes; read after `revoke()` rejects `handle_revoked`; revoke during a pending open rejects and destroys the stream; revoke destroys an open stream mid-read; missing blob rejects `BlobMissingError`; `blobs` absent rejects `store_unbound`; metadata copied unchanged; `revoke()` idempotent.
   - `server/src/compose-app-deps.test.ts` (unit): the pack, versions and findings QC bindings carry the store as `blobs`.
   - `tests/integration/w4-05a-artifact-handles.test.ts`: through the orchestrator with `blobs`, a runner reads every artifact of the vendor fixture during a submit and a lane run (sha256 and length match) and the kept handles reject after the run; without `blobs` the handles reject during the run; a runner that ignores the deadline finds its handles revoked once the signal aborts; the unbound runner and a replay leave no live handle; through the composed app (HTTP lane QC route) the runner reads real bytes.
3. GREEN: `qc/artifact-handles.ts`; `orchestrator.ts` (`blobs?`, `buildRequest` returns `{ request, revoke }`, `callRunner` revokes in `finally` and on abort, outer `finally` in `runQc` and `runUploadQc`); `app.ts` `QcBinding` adds `blobs`; `compose-app-deps.ts` passes the store.
4. Records: review.md with exact commands and results, DEVLOG top entry, CHANGELOG line under 2026-09-27.
5. Full gate (lint, typecheck, unit, integration, build + substitute-absent, browser server and substitute, links, diff check), commit, push, PR "Refs #211".

> **Correction, 2026-09-28 (round 1 review).** Step 2's "the unbound runner and a replay leave no live handle" has no integration case: with no runner nothing ever calls `read()`, and a replay returns before any request is built, so neither is observable from outside the orchestrator. The unbound path is covered by `withRevocation` (reviewed in code) and the replay path builds no handles. The six integration cases that exist are listed in review.md.
