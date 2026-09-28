# Spec: real, revocable artifact read handles (W4-05a, #211)

Source: [W4b plan](../../docs/engineering/implementation-plan-w4b.md) section 4.1 and section 15 row W4-05a; W0-07 3.3 (`AuthorizedArtifactRef.read`: "Read-only; the server revokes it when the run ends", [QC boundary](../../docs/engineering/qc-boundary-and-mail-sink.md)). The plan assigns no spec amendment to this ticket; the W0-07 contract already says the handle is revocable, and this ticket implements it.

## Behaviour

1. **Handles.** `server/src/qc/artifact-handles.ts` exports `authorizedHandles(blobs, artifacts)`. It takes the optional `BlobStore` and the artifact metadata of the request (`AuthorizedArtifactRef` without `read`) and returns `{ refs, revoke }`: `refs` are the request's `AuthorizedArtifactRef`s, `revoke()` ends them all. `revoke()` is idempotent.
2. **Read.** `read()` calls `blobs.open(contentHash)` and returns the Node stream converted with `Readable.toWeb`. Reading it to the end yields exactly the stored bytes (their sha256 is `contentHash`, their length `byteLength`). Each call opens a fresh stream.
3. **Rejections.** `read()` rejects, never resolving an empty stream, when:
   - `blobs` is absent: `ArtifactReadError` with `detail = 'store_unbound'`;
   - the handle was revoked: `ArtifactReadError` with `detail = 'handle_revoked'`, including when the revocation lands while `blobs.open` is pending (the opened stream is destroyed);
   - the blob is missing: the store's `BlobMissingError` propagates unchanged (plan 4.1: the content runner maps it to `artifact_unreadable`, detail `blob_missing`).
   Error messages carry no path, filename or document text (W0-10); `ArtifactReadError` carries only its detail code.
4. **Revocation of open streams.** `revoke()` also destroys every stream a handle opened that is still open, so a runner cannot keep reading a stream it opened before the run ended; such a stream errors instead of ending early as if the document were shorter.
5. **Orchestrator.** `QcOrchestratorDeps.blobs?: BlobStore` is new and optional. `buildRequest` builds the request's artifacts through `authorizedHandles(deps.blobs, …)` and returns the request with its `revoke`. `callRunner` revokes in its `finally` once the runner settles, and revokes as soon as the deadline aborts the signal, even if a runner ignores the signal and never settles. Every path that builds a request and does not call the runner (unbound runner, rule selection error, upload in-flight join, a thrown error) also revokes, in an outer `finally`. (Wording corrected 2026-09-28, round 1 review: a replay returns before any request is built, so it holds no handles to revoke.)
6. **Composition.** `compose-app-deps.ts` passes the app's `BlobStore` as `blobs` in every QC binding it creates (pack upload trigger, submit trigger, lane QC route); `app.ts`'s `QcBinding` admits it. Which bindings exist, and when, is unchanged.
7. **Unchanged.** `QcRunRequest`, `runKey`, every runner (scripted substitute, `deterministic`), `tests/support/fixture-app.ts` and the integration suites that build orchestrator deps by hand (they omit `blobs`, which the deterministic and scripted runners never need).

## Out of scope

The content runner and its mapping of these rejections to `artifact_unreadable` and `blob_missing` (W4-06a); extraction (W4-05b-d); read size or time limits beyond the run deadline (the extractor's limits, W4-05b).
