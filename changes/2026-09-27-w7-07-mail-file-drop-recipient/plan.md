# Plan

1. Board CLAIM (lane A stream) with the section 9.1 shared-file note. Change frame (this folder).
2. RED:
   - `shared/src/mail/file-stem.test.ts`, `shared/src/mail/validate.test.ts`: the moved contract answers as before.
   - `server/src/notifications/file-drop.test.ts`: W0-07 4.8 rows for a file sink (valid delivery, each validation code, duplicate, restart keeps duplicate, corrupt file ignored, concurrent one delivered one duplicate, names equal `mailFileStem`, `{ request, receipt }` shape, 0600/0700, health, write failure).
   - `fixtures/src/substitutes/mail-sink/file-drop-parity.test.ts`: the drop and `FileMailSink` write the same names and the same JSON for one request; a drop file reads as `MailSinkFile`.
   - `server/src/notifications/directory.test.ts`: fixed vs live views, load, `recorded`, mode filter, load-retry; static and function recipient deps give the same notices.
   - `server/src/identity/adapter.test.ts`: `configuredGrants()` per mode.
   - `server/src/start.test.ts` (new cases only): binding table per identity mode and `MAIL_MODE`, readiness mail `file` `ok`.
   - `tests/integration/w7-07-file-drop.test.ts`: local-google shape; profile holders, one signed in after the directory loaded, receive lane-open files; readiness `ready` with mail `file`.
3. GREEN: shared move and re-exports; `file-drop.ts`; `directory.ts`; service widenings; `compose-app-deps.ts`; `identity/types.ts`, `adapter.ts`, `allow-list.ts`; `start.ts`; `no-external-mail.test.ts` walks `file-drop.ts`.
4. Docs: W0-07, W0-10, W0-03, W0-02 dated notes.
5. Full gate one suite at a time, logs under `/tmp/rai-w7-07-mail-file-drop-recipient-logs/`.
6. review.md, DEVLOG, CHANGELOG; commit, push, verify the remote head, open the PR ("Refs #225").
