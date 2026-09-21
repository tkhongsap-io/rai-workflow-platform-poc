# Plan: W1-11 — mail-sink substitute per W0-07

2026-09-21. Ticket W1-11 (issue #26), lane C, owner type Agent-eligible. Branch `codex/w1-11-mail-sink`, worktree `/Users/tkhongsap/github/rai-wt/W1-11`. Depends on W0-07 ([QC boundary and mail sink](../../docs/engineering/qc-boundary-and-mail-sink.md) sections 4.2-4.8) and W1-00 (merged: `rai-web/shared/src/mail/types.ts`, `server/src/config.ts` with the `MAIL_MODE` value set, the fixtures workspace and its `substitute-marker.ts`; the W1-00 amendment PR #71 (`codex/w1-00-mail-dedup`) adds `shared/src/mail/dedup.ts` and merges before this PR). Proves A05 at the unit layer (W0-07 section 8); W3-03 and W3-04 consume it.

## Intent

A sink the W3-03 dispatcher can call once per queued `notification` row: it takes the four W0-07 inputs (committed event, authorized recipient, safe deep links, dedup key) inside a `DeliveryRequest`, answers a `DeliveryReceipt` with `delivered | failed | duplicate`, can be told to fail from a control API, and leaves no path by which a mail could leave the process. Two implementations, both under `rai-web/fixtures/src/substitutes/mail-sink/` as W0-02 section 1 places them: in-memory (tests, CI) and file (one JSON and one text file per attempt under `MAIL_SINK_DIR`).

## Scope (files)

- `rai-web/fixtures/src/substitutes/mail-sink/` — `validate.ts` (the section 4.3 checks in the listed order, one function shared by both sinks), `control.ts` (`MailSinkControl` and the forced-failure state), `memory.ts` (`MemoryMailSink`), `file.ts` (`FileMailSink`), `index.ts`; colocated `*.test.ts` covering every row of the section 4.8 table.
- `rai-web/fixtures/src/index.ts` — re-export the sink module (Lane C file).
- `changes/2026-09-21-w1-11/plan.md`, `review.md`.

Not touched: `rai-web/shared/` (Lane A; `mail/dedup.ts` arrives through the W1-00 amendment PR #71, this ticket only consumes `buildDedupKey` per W0-07 sections 4.7-4.8), `server/src/config.ts` (already accepts exactly `sink-file | sink-memory` and refuses anything else; the W1-11 test exercises it through `@rai/server/config`), `server/src/notifications/` (W3-03/W3-04), `package.json` scripts (`test:unit` already globs `fixtures/src/**/*.test.ts`), `.env.example`, the frozen source spec, `docs/board`, DEVLOG.

## Behaviour to implement (from W0-07)

1. **Validation, section 4.3, in order**: links non-empty, same origin as `PUBLIC_BASE_URL`, canonical path, no query/fragment/credential-looking segment (`unsafe_link`, message names the index); link-to-event correspondence for the three case-bound kinds and the digest (`unsafe_link`); synthetic-domain rule on `recipient.address` (`rejected_recipient`); every link URL present in `textBody` (`unsafe_link`); `auditEventId` non-empty (`malformed_request`); dedup identity complete (`malformed_request` naming `event.digestDay` or `event.versionId`); subject ≤ 998 bytes and body ≤ 65 536 bytes (`sink_failure` naming the field and its byte size). A rejected request records nothing and does not mark its key accepted.
2. **Dedup, section 4.4**: an accepted key answered `duplicate` on repeat, `sent` unchanged; the file sink rebuilds its index from the directory on construction.
3. **Forced failure, section 4.7**: `failNext(n)`, `failWhen(predicate)`, `failAlways(on)`, `find`, `sent`, `receipts`, `reset`; a forced failure is `failed:sink_failure`, records the receipt but no delivery and does not mark the key accepted, so the retry can deliver.
4. **File sink, section 4.7**: `${sha256(dedupKey).slice(0,16)}-${attempt}.json` and `.txt`; the address never appears in a file name; `correlationId` recorded; nothing beyond IDs from the event.
5. **No external mail path, sections 4.6 and 4.8**: the sinks import only `node:crypto`, `node:fs/promises`, `node:path` and `@rai/shared`; a test walks every `.ts`/`.tsx`/`.mjs`/`.js` source under `rai-web/` (outside `node_modules` and `dist`) and fails on `node:net`, `node:tls`, `node:http`, `node:https` or `nodemailer`/mail-SDK imports in the sink directory, and on any mail SDK anywhere; `parseConfig` refuses `MAIL_MODE=smtp`, `sink-smtp`, `memory` and unset, naming the key.
6. **Readiness hook**: `health()` (`'ok'` for memory; `'ok'` when `MAIL_SINK_DIR` is writable, else `'unavailable'`) for the W0-10 `mailSink` probe. Not part of the shared `MailSink` interface (Lane A's), exposed on the classes.

## Checks to run afterwards

`node --test tests/*.test.mjs` (demo suite, repository root); in `rai-web/`: `npm run test:unit`, `npm run lint`, `npm run typecheck`, `npm run build && npm run check:substitute-absent`. `npm run test:integration` against Postgres on port 54331 (`docker compose -p rai-w1-11`) to show the existing integration suite still passes; this ticket adds no integration test (W0-07 section 4.8 places every W1-11 test in the unit layer).
