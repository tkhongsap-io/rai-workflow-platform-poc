# Spec: mail file drop, recipient and BU directories (W7-07)

Source: W7 plan sections 2 (`MAIL_MODE` row), 5.3, 9 row W7-07, 9.1 and 13; the plan wins over issue #225.

## Mail file drop — `server/src/notifications/file-drop.ts`

`createFileDropMailSink({ dir, publicBaseUrl, now? })` returns a `MailSink` with identity `{ sink: 'file', version: 'w7-07' }` and `health()`. Per delivery, serialized per `dedupKey`:

1. `validateDeliveryRequest(request, origin)` (from `@rai/shared/mail/validate`); a failure answers `failed` with that error and writes nothing.
2. On first use (again after a failed load) the directory is created 0700 and the accepted-key index is rebuilt from every `^[0-9a-f]{16}-\d+\.json$` file whose receipt is `delivered`; a half-written or foreign file marks nothing. A load failure answers `failed` / `sink_failure` (errno code only).
3. An accepted `dedupKey` answers `duplicate` (`error.code 'duplicate'`) and writes nothing.
4. Otherwise `<mailFileStem(dedupKey, attempt)>.txt` then `.json` (`{ request, receipt }`, `receipt.sinkMessageId` = the JSON name) are each written to `<name>.<pid>.tmp` (flag `wx`, mode 0600) and renamed; the key is then accepted and the receipt `delivered`. A write failure answers `failed` / `sink_failure` and leaves the key unaccepted. The text copy carries `X-RAI-Sink: file (in-product drop; nothing was sent)`.

No forced-failure control, no marker, no import from `@rai/fixtures`, no transport. `health()` is `ok` when the directory exists (created on demand) and is writable, else `unavailable`.

## Shared contract

`shared/src/mail/validate.ts` (moved verbatim from `fixtures/src/substitutes/mail-sink/validate.ts`) and `shared/src/mail/file-stem.ts` (`mailFileStem`, `node:crypto`). The fixtures `validate.ts` becomes a re-export; `file.ts` imports and re-exports `mailFileStem`. Every fixture export name is unchanged.

## Binding — `start.ts`

`fixture` mode unchanged (`loadMailSink`). `local-google` or `network` with `MAIL_MODE=sink-file` binds the file drop at `MAIL_SINK_DIR`; with `sink-memory` nothing is bound (today). `parseConfig` unchanged. Readiness `mailSink.kind` stays `file` for `sink-file`, now `ok` when the directory is writable.

## Recipient directory — `server/src/notifications/directory.ts`

`createRecipientDirectory({ fixtureUsers })` is fixed (fixture mode: the same values as today). `createRecipientDirectory({ identityMode })` is live: `load(db)` reads every `subject_profile` row of that identity mode; `recorded(profile)` replaces one row (newer `lastSignInAt` wins over a concurrent load). Synchronous views recomputed from the current snapshot: `identities()`, `laneOpenRecipients()`, `laneReviewerSpocUnits()`, `ownerRecipients(subjectId)`.

Consumers: `versions/service.ts` `laneOpenRecipients` and `laneReviewerSpocUnits` accept `T | (() => T)`, resolved at the submit read site; `notifications/service.ts` `identities` accepts `readonly MailIdentity[] | (() => readonly MailIdentity[])`, resolved once per delivery. `compose-app-deps.ts` takes an optional `recipients` directory (default: fixed over the fixture users) and, when one is given, binds `identity.profiles.recorded` to it. `start.ts` passes a live directory only when the file drop is bound, loads it before `listen`, and records a load failure as `error.captured` (the directory retries the load in the background on the next read).

## Business units

`IdentityAdapter.configuredGrants(): readonly RoleScope[]`: the allow-list's grants in `network`/`allow-list`, the role map's in `local-google` with a map, `[]` otherwise (never emails). `AllowListResolver.grants()` supplies them. `start.ts` adds `businessUnitsFromGrants(adapter.configuredGrants())` to the BU directory.

## Docs

W0-07 dated amendment (file drop, naming, validate/duplicate/restart index, contract move, recipient directory); W0-10 dated note (mail `file` outside fixture mode); W0-03 dated note (`configuredGrants`); W0-02 dated note (`MAIL_MODE` binding per identity mode).
