# Review: real, revocable artifact read handles (W4-05a, #211)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W4b plan](../../docs/engineering/implementation-plan-w4b.md) section 4.1 and section 15 row W4-05a, under the register rows "Ta's delegation (2026-09-27)" and "W4b delegated rulings (provisional)". D07-D10 stay open. No migration, no rule, no model, no network call; synthetic data only.

## Change

- **Handles** (new `server/src/qc/artifact-handles.ts`): `authorizedHandles(blobs, artifacts)` returns `{ refs, revoke }`. `read()` opens `blobs.open(contentHash)` and returns it through `Readable.toWeb`; it rejects with `ArtifactReadError` `store_unbound` when no store is bound and `handle_revoked` after `revoke()` (also when the revocation lands while `open` is pending; the opened stream is destroyed); a missing blob rejects with the store's `BlobMissingError`. `revoke()` is idempotent and destroys every stream a handle opened that is still open, so such a stream errors instead of ending short. Errors carry a detail code only.
- **Orchestrator** (`server/src/qc/orchestrator.ts`): new optional `QcOrchestratorDeps.blobs`. `buildRequest` takes the store, builds the artifacts through `authorizedHandles` last (nothing after it can throw) and returns `{ request, revoke }`. `callRunner` revokes when the deadline aborts the signal and in its `finally` once the runner settles. `runQc` and `runUploadQc` run inside a new `withRevocation` helper that revokes, in `finally`, every request they built, which covers the paths that never call the runner (unbound, rule selection error, an upload caller that joins another's in-flight run, a thrown error). The placeholder `read: () => Promise.resolve(new ReadableStream())` is gone.
- **Composition**: `app.ts` `QcBinding` admits `blobs`; `compose-app-deps.ts` passes its `BlobStore` in every QC binding (pack upload, submit, lane QC). Which bindings exist is unchanged: with no runner, the submit binding is `{ blobs }` (was `{}`) and the pack and findings bindings stay absent.
- **Unchanged**: `QcRunRequest`, `runKey`, the scripted substitute and `deterministic` runners and their tests, `tests/support/fixture-app.ts`, and every integration suite that builds orchestrator deps by hand (they omit `blobs`; their runners never read).
- **Tests**: new `server/src/qc/artifact-handles.test.ts` (7 cases), `server/src/compose-app-deps.test.ts` (2 cases), `tests/integration/w4-05a-artifact-handles.test.ts` (6 cases: submit, lane and upload runs read every artifact's stored bytes, checked by sha256 and length, and the kept handles reject afterwards; without `blobs` all nine reads reject `store_unbound`; a runner that ignores the deadline finds its handle revoked when the signal aborts; through the composed app the HTTP lane QC route hands out handles that read real bytes).

## Deviations

- **Error shape.** The plan says `read()` "rejects" without naming the error. Chosen: `ArtifactReadError` with `detail` `store_unbound` or `handle_revoked`, and the store's own `BlobMissingError` passed through unchanged, so W4-06a can map `BlobMissingError` to detail `blob_missing` as plan 4.1 says and the other two to `artifact_unreadable`.
- **Open streams destroyed on revoke.** The plan requires only that a `read()` after revocation rejects. A runner that opened a stream during the run could otherwise keep reading it after the run ended, which defeats "revocable"; destroying it (with an error, so it never looks like a shorter document) is the smallest rule that closes that gap.
- **Revocation on paths without a runner call.** The plan names the `finally` around the runner. The request is built before the orchestrator knows whether it will call the runner, and an upload caller that joins another's in-flight run never passes its request to a runner, so those handles are revoked by an outer `finally` as well.
- **Submit binding with no runner** now carries `{ blobs }` instead of `{}` ("compose-app-deps always passes it"); its run still records `unbound` / `not_configured` and never reads.
- **One new test expectation changed before commit** (no existing test changed): the first draft of the deadline case let the stubborn runner return `completed` after the deadline and expected a `timeout` row; the orchestrator (unchanged here) accepts a result the runner returns after the abort, so the probe now throws after its refused read, as a content runner that cannot read would. The revocation assertion is unchanged.
- **Lane environment**: `RAI_PG_TOOLS=docker-compose:rai-qc-core` in the uncommitted `.env` (the example's `rai-dev` container does not exist for this lane), set before the integration run.

## Observation (not changed here)

`callRunner` accepts a well-formed `completed` result that a runner returns after the deadline aborted its signal: the run is recorded as `completed`, not `timeout`. This is pre-existing (W2-05) and outside the W4-05a row; the handles are revoked at the abort either way, so such a runner can no longer read. Worth a look when W4-06a or W4-18 touch `callRunner`.

## Checks

| Command (from `rai-web/` unless noted) | Result |
|---|---|
| RED: `node --import tsx --conditions=rai-source --test server/src/qc/artifact-handles.test.ts server/src/compose-app-deps.test.ts tests/integration/w4-05a-artifact-handles.test.ts` before the change | failed for the right reasons: `artifact-handles.js` not found (unit and integration files); both compose cases failed (no `blobs` on the bindings) |
| same, after the change | 15/15 |
| `npm ci` | exit 0 |
| `npm run lint` | exit 0 (after fixing two `unbound-method` findings in the new code) |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | 1066/1066 |
| `npm run test:integration` | 460/460, 0 skipped |
| `npm run build && npm run check:substitute-absent` | exit 0; 939 files scanned, 0 with the marker |
| `npm run test:browser:server` | 217 passed |
| `npm run test:browser:substitute` | 48 passed |
| `node scripts/check-links.mjs` (root) | 477 Markdown files, 1330 links, 0 broken (after the records were added) |
| `git diff --check` and `git diff --cached --check` (root) | clean |

## Round 1 fixes (2026-09-28)

- **Rebased onto origin/main `3b5e506`** (W6-04). `compose-app-deps.ts` conflicted: main added `configuration: { subjects, ...mailMode }` and `artifacts: { store: inputs.store, … }`; kept main's `configuration` line and the branch's `artifacts: { store, … }` (`store` is destructured from `inputs`, the same value). CHANGELOG, DEVLOG and the lane-a board conflicted only by adjacent appends; both sides kept, no existing line changed. No migration on either side.
- **`runUploadQc` tracks the built request inside the read-only transaction callback**, as `runQc` does, so a failed commit still revokes the handles (reviewer note; behaviour otherwise unchanged).
- **plan.md step 2** carries a dated correction: the promised "unbound runner and replay leave no live handle" integration case does not exist and is not observable from outside (no runner, no `read()`; a replay builds no request). **spec.md item 5** no longer lists "replay after build" as a revoking path (dated note).

### Deferred (reviewer notes, not changed here)

- `callRunner` accepts a `completed` result returned after the deadline aborted the signal (pre-existing, see Observation): to get its own issue before W4-06a or W4-18.
- A malformed `contentHash` makes `blobs.open` throw a plain `Error` rather than `ArtifactReadError`; unreachable from DB rows. W4-06a should map any unknown read rejection to `artifact_unreadable`.

### Round 1 checks (rebased head)

| Command (from `rai-web/` unless noted) | Result |
|---|---|
| `npm ci` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | 1075/1075 |
| `npm run test:integration` | 480/480, 0 skipped |
| `npm run build && npm run check:substitute-absent` | exit 0; 959 files scanned, 0 with the marker |
| `npm run test:browser:server` | 217 passed |
| `npm run test:browser:substitute` | 48 passed |
| `node scripts/check-links.mjs` (root) | 485 Markdown files, 1349 links, 0 broken |
| `git diff --check` (root) | clean |

## Round 2 fixes (2026-09-28)

- **Rebased onto origin/main `051bdec`** (W7-08, W4-06c, W7-07, W4-06b, W6-15). `compose-app-deps.ts` conflicted with W7-07: main added the recipient directory (`inputs.recipients ?? createRecipientDirectory(...)`), a subjects comment and `versions.laneOpenRecipients` / `laneReviewerSpocUnits` from `recipients.*`. Resolved keeping both behaviours: main's recipient directory, comment and `recipients.*` reads, plus this branch's `store` destructuring, the `qc = { runner, blobs: store }` binding and `versions.qc: qc ?? { blobs: store }`. CHANGELOG and DEVLOG took the W4-05a entry on top; the lane-a board keeps every main CLAIM and appends the W4-05a CLAIM at the end; no existing line changed. No migration on either side.
- **`callRunner` removes its abort listener in `finally`** (reviewer polish). No behaviour change: the listener was once-only and `revoke` idempotent.
- Lane environment only (not committed): `.env` sets `RAI_PG_TOOLS=docker-compose:rai-qc-core` so the W7-01/W7-02 backup suites find this lane's Postgres container; with the example value `rai-dev` six of them fail with `pg_tools_container_not_found`.

### Deferred (unchanged from round 1)

- A `completed` result returned after the deadline is accepted (pre-existing), and a malformed `contentHash` rejects with a plain `Error`; both to get an issue before W4-06a or W4-18 (W4-06a maps any unknown read rejection to `artifact_unreadable`).

### Round 2 checks (rebased head)

| Command (from `rai-web/` unless noted) | Result |
|---|---|
| `npm ci` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | 1204/1204 |
| `npm run test:integration` | 497/497, 0 skipped |
| `npm run build && npm run check:substitute-absent` | exit 0; 1055 files scanned, 0 with the marker |
| `npm run test:browser:server` | 232 passed |
| `npm run test:browser:substitute` | 48 passed |
| `node scripts/check-links.mjs` (root) | 513 Markdown files, 1402 links, 0 broken |
| `git diff --check` (root) | clean |

## Round 3 fixes (2026-09-28)

- **Rebased onto origin/main `0a35d9b`** (W4-06d, W6-06, W7-16, W4-08a, W5-09, W6-05). The branch's three commits were replayed as one commit on `0a35d9b`; `orchestrator.ts` conflicted with W4-08a, which moved the pure request builder into `qc/request.ts` (`requestOf`) and `checkedResult` / `callRunner` / `unavailableResult` into `qc/check-result.ts` (shared with the evaluation harness). Ported, keeping both behaviours:
  - `buildRequest` still reads the slot rows and calls W4-08a's `requestOf` unchanged, then replaces the artifacts' placeholder `read()` with `authorizedHandles(blobs, request.artifacts)` (metadata, and so the `runKey`, unchanged) and returns `{ request, revoke }`. `request.ts` keeps its placeholder, as the harness binds its own `read()` after `requestOf`.
  - `check-result.ts` `callRunner` gains an optional fifth parameter `revoke`: added as a once-only abort listener, removed and called in `finally` (the round 2 behaviour, moved with the function). The harness and existing `check-result.test.ts` calls omit it and behave as before. The orchestrator passes `built.revoke`.
  - `withRevocation`, `runQc` and `runUploadQc` are the round 2 code unchanged apart from the `callRunner` call (their bodies on main were identical to the merge base's).
  - CHANGELOG, DEVLOG and the lane-a board: the W4-05a lines re-appended (entries on top, CLAIM at the end); no existing line changed.
- **New test**: `check-result.test.ts` case "callRunner revokes when the deadline fires, before a runner that ignores the abort settles, and once it settles" (RED before the `revoke` parameter existed: 0 revocations; GREEN after). No existing expectation changed.
- **Deviation**: the plan row's file list predates W4-08a; `check-result.ts` and `check-result.test.ts` are touched because `callRunner` now lives there.
- **Correction (reviewer polish)**: the round 1 and round 2 notes say "W4-06a should map any unknown read rejection". W4-06a has merged: its content runner maps every `read()` rejection to `artifact_unreadable` / `blob_missing`, so `store_unbound`, `handle_revoked` and a missing blob are not told apart by `detail`. Recorded as deferred below, not changed here.

### Deferred (reviewer notes, not changed here)

- `callRunner` accepts a `completed` result returned after the deadline aborted the signal (pre-existing); to be filed as its own issue before W4-18.
- The content runner's single `blob_missing` detail for every read rejection (see correction above).
- An upload caller that joins another's in-flight run builds handles it never uses (revoked in `finally`; wasted work only).
- A malformed `contentHash` rejects with a plain `Error` (unreachable from DB rows).

### Round 3 checks (rebased head)

| Command (from `rai-web/` unless noted) | Result |
|---|---|
| RED: `node --import tsx --conditions=rai-source --test server/src/qc/check-result.test.ts` before the `revoke` parameter | new case failed (`revoked once the runner settled`: 0 !== 1) |
| same, after | 8/8 |
| `npm ci` | exit 0 |
| `npm run lint` | exit 0 (after replacing a destructured `read` that tripped `unbound-method`) |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | 1284/1284 |
| `npm run test:integration` | 501/501, 0 skipped |
| `npm run build && npm run check:substitute-absent` | exit 0; 1083 files scanned, 0 with the marker |
| `npm run test:browser:server` | 256 passed |
| `npm run test:browser:substitute` | 48 passed |
| `node scripts/check-links.mjs` (root) | 538 Markdown files, 1468 links, 0 broken |
| `git diff --cached --check` (root) | clean |

## Verdicts

| Round | Head | Reviewer | Verdict |
|---|---|---|---|
| 1 | `9aaa544` | reviewer A | pass on the ticket (done-when met; notes non-blocking); rebase conflict in `compose-app-deps.ts` blocked the merge |
| 1 | `9aaa544` | reviewer B | pass (done-when met; notes non-blocking) |
| 2 | `85520e4` | reviewer A | pass (done-when met; notes non-blocking); rebase onto `051bdec` conflicted in `compose-app-deps.ts` and blocked the merge |
| 2 | `85520e4` | reviewer B | pass (done-when met; no regression found; notes non-blocking) |
| 3 | `694514e` | reviewer A | pass (done-when met; notes non-blocking); rebase onto `0a35d9b` conflicted in `orchestrator.ts` (W4-08a refactor) and blocked the merge |
| 3 | `694514e` | reviewer B | pass (done-when met; no regression found; notes non-blocking) |
| 4 | rebased head | pending | two independent reviewer verdicts on the exact head (D03 ticket flow) |
