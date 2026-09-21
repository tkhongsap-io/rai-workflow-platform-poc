# Review: W1-11 — mail-sink substitute per W0-07

2026-09-21. Ticket W1-11 (issue #26), lane C, owner type Agent-eligible. Branch `codex/w1-11-mail-sink`, worktree `/Users/tkhongsap/github/rai-wt/W1-11`. Plan recorded before code in [plan.md](plan.md). Proves A05 at the unit layer ([W0-07 section 8](../../docs/engineering/qc-boundary-and-mail-sink.md#8-test-layer-map-for-this-spec)); W3-03 and W3-04 consume the sink. Human review remains authoritative; nothing here is merged, published or promoted to production acceptance.

## What landed

- `rai-web/fixtures/src/substitutes/mail-sink/` (Lane C, the W0-02 path):
  - `validate.ts` — the W0-07 section 4.3 checks in the listed order, one function for both sinks: links non-empty, same origin as `PUBLIC_BASE_URL`, canonical route path (`/cases/:caseId`, `/cases/:caseId/versions/:versionId`, `/queue[/segment]`; the SPA owns the strings, this is the defensive copy), no `?`, `#`, user-info or credential-looking segment; link-to-event correspondence for the three case-bound kinds and the digest (one `case` link per `digestCases` entry, each referenced exactly once, at most one `queue_sla_breach` link); the section 4.6 synthetic-domain rule (`*.test`, `*.example`, `*.invalid`, `example.com|net|org`); every link present in `textBody`; `auditEventId` non-empty; complete dedup identity; subject ≤ 998 bytes and body ≤ 65 536 bytes. Error messages name a field or an index, never an address, URL, subject or body.
  - `control.ts` — `MailSinkControl` (`failNext`, `failWhen`, `failAlways`, `find`, `sent`, `receipts`, `reset`) and the forced-failure state; the names W0-10 section 8.1 expects. Control API only; no configuration key.
  - `base.ts` — the shared flow: validate → load the accepted-key index → `duplicate` for an accepted key → forced failure → record. A rejected, forced-failed or duplicate request records nothing and does not consume its key; every receipt is kept in `receipts`. A real sink error (e.g. `EACCES`) is `failed:sink_failure` with the errno code only. `health()` for the W0-10 readiness `mailSink` probe.
  - `memory.ts` — `MemoryMailSink` (`MAIL_MODE=sink-memory`); `sinkMessageId` is `memory:<n>`.
  - `file.ts` — `FileMailSink` (`MAIL_MODE=sink-file`): `${sha256(dedupKey).slice(0,16)}-${attempt}.json` (full request and receipt) and `.txt` (To, Subject, template key, locale, event kind, correlation ID, audit event ID, attempt, then the body), written atomically; the directory is created on first use; the accepted-key index is rebuilt from the `.json` files whose receipt is `delivered`, so `duplicate` survives a restart. File names never carry the address or a case ID.
  - `index.ts`, `support.ts` (test request builders, synthetic values only) and the five test files below. Both sinks reference `SUBSTITUTE_MARKER`; the sinks import only `node:crypto`, `node:fs/promises`, `node:path` and `@rai/shared` (W0-07 section 2 rule), enforced by a test.
- `rai-web/fixtures/src/index.ts` — re-exports the sink module.

Not touched: `rai-web/shared/` (Lane A; `mail/dedup.ts` lands through the W1-00 amendment PR #71, `codex/w1-00-mail-dedup`, which this branch is based on and which merges first; this ticket consumes `buildDedupKey` per W0-07 sections 4.7-4.8), `server/src/config.ts` (already accepts exactly `sink-file | sink-memory`; the W1-11 test exercises it), `server/src/notifications/` (W3-03/W3-04 select the sink from the typed config), `package.json` scripts, dependencies (none added), `.env.example`, `TESTING.md` (no command changes; `test:unit` already globs `fixtures/src/**/*.test.ts`), `docs/architecture/README.md` (its "Path in repo" column already names `rai-web/fixtures/src/substitutes/mail-sink/`), the frozen source spec, `docs/board`, DEVLOG, CHANGELOG.

## Done-when mapping

| Clause | Evidence |
|---|---|
| Accepts the four inputs and returns a status | `mail-sink.test.ts`: a valid `lane_opened` request → `delivered` with `sinkMessageId`, `attempt` and `dedupKey` echoed; a digest with three `case` links, three `digestCases` entries and all URLs in the body → `delivered`; negative cases (unsafe link single and one-of-five in a digest, non-synthetic recipient, malformed, oversize) each return `failed` with the section 4.3 code and record nothing; a rejected key delivered afterwards is `delivered`, not `duplicate`; Thai subject byte-identical through both sinks |
| A forced failure is reported | `failNext(1)` → `failed:sink_failure`, the same request again → `delivered`; `failAlways(true)` → four consecutive `failed`, off again → `delivered`; `failWhen(predicate)` fails only matching requests until `reset()`; on both sinks; a forced failure writes no file |
| No external mail path exists in any configuration | `no-external-mail.test.ts`: the sink sources import only the allow-list; no source file under `rai-web/` (any workspace) imports a transport built-in in the sinks or a mail SDK anywhere; no manifest or `package-lock.json` entry names a mail SDK; `parseConfig` refuses `MAIL_MODE=smtp`, `sink-smtp`, `memory`, `file`, `SINK-MEMORY`, `ses`, `http` with `invalid:MAIL_MODE` and unset/empty with `missing:MAIL_MODE` |
| D06 dedup, W0-04 identity | `dedup-key.test.ts`: `lane_open:V:ai_coe:ai-coe@rai-desk.example` (W0-04 `event` value, not `lane_opened`); one address through two `recipientId`s is one key, two addresses two keys; `ready:V:-:<address>`; `send_back:V:dpo:<address>`; the digest key reads `2026-09-21` from `event.digestDay` with `committedAt` on the previous day; `RangeError('event.digestDay' | 'event.versionId')` for an incomplete identity. `mail-sink.test.ts`: second delivery of a key → `duplicate`, `sent.length` unchanged, even under `failAlways` |
| File sink restart (4.7) | `file-sink.test.ts`: two receipts, a new `FileMailSink` on the same directory, a redelivered key → `duplicate`; a failed attempt or a half-written file marks nothing accepted |
| No secrets or contents on disk | `file-sink.test.ts`: output contains the deep link and IDs, not the `RAI-DESK-SYNTHETIC-FIXTURE` sentinel, password-like environment values or the actor's email; file names hold the hashed key only |

## Commands run and results

All from the worktree, `export PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH`, Node 24.21.0, npm 11.

| Command | Result |
|---|---|
| `npm ci` (in `rai-web/`) | installed from the committed lock file; no dependency added |
| `npm run typecheck` | `tsc -b`, clean |
| `npm run lint` | eslint clean; `All matched files use Prettier code style!`; `check-css: no outline removal outside :focus-visible` |
| `node --test tests/*.test.mjs` (repository root, demo suite) | tests 22, pass 22, fail 0 |
| `npm run test:unit` | tests 108, pass 108, fail 0 (62 on the base branch `codex/w1-00-mail-dedup`, i.e. 58 from W1-00 + 4 from #71, plus 46 from this ticket: 5 dedup key, 30 cross-sink [memory]/[file] pairs plus 1, 5 file sink, 5 no-external-mail) |
| `POSTGRES_PORT=54331 docker compose -p rai-w1-11 up -d --wait` then `npm run migrate` with `DATABASE_URL`/`DATABASE_MIGRATE_URL` on port 54331 | `migrate: applied 1 migration(s), 0 already applied` |
| `npm run test:integration` (port 54331) | tests 14, pass 14, fail 0 (the W1-00 suite; W1-11 adds no integration test, per W0-07 section 4.8 every W1-11 test is unit-layer) |
| `npm run build && npm run check:substitute-absent` | `check-substitute-absent: scanned 138 files, 0 with the marker` |
| `npm run test:browser` | not run: `tests/browser/` holds only `playwright.config.ts`, no spec exists yet |
| `POSTGRES_PORT=54331 docker compose -p rai-w1-11 down -v` | removed |

Mutation checks during development (not committed): disabling `failAlways` in `control.ts` failed 2 tests; skipping the recipient check in `validate.ts` failed 4 tests. Both restored; final run 46/46.

## Limitations and notes for the lead

- Fix round 1: review refused the Lane C touch on `shared/src/mail/dedup.ts`. The file moved to the W1-00 amendment PR #71 (Lane A contract PR, verbatim W0-07 section 4.4, with its own unit test); this branch was rebased on it with no other source change and its PR base is that branch until #71 merges. `dedup-key.test.ts` (the W0-07 4.8 row) stays here and asserts on the shared function.
- The canonical route patterns in `validate.ts` are the sink's defensive copy of `<origin>/cases/:caseId[...]` (W0-05 section 6) and `/queue[/segment]`; W1-07 / W3-02 own the SPA path strings and W3-03 builds the links, so a route spelled differently there is a one-line update here, caught by the W3-03 integration tests.
- `health()` is exposed on the sink classes (W0-10 section 8.1 hook) and not added to the shared `MailSink` interface, which Lane A owns.
- Section 10 of W0-07 (`MAIL_SINK_FAIL_NEXT` key) stays unimplemented: forced failure is control-API only, as section 6 states.
- D07-D10 untouched; no transport, no credential, no real address anywhere; all fixture addresses are at RFC 2606 reserved domains.
