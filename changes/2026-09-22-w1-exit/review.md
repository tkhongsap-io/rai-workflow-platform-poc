# Review: W1 exit — scoped case and versioned pack (Milestone M1)

2026-09-22. Ticket W1-08 (issue #30), lane Lead, owner type Human; the record is written by the delegated ticket flow (D03 amendment) for Ta's review. Branch `codex/w1-08-w1-exit`, worktree `/Users/tkhongsap/github/rai-wt/W1-08`, base `origin/main` at `5230f48` (W1-INT merged; every other W1 ticket — W1-00 to W1-07, W1-09 to W1-13, W1-INT — merged before this record started, PRs #67-#87). Postgres `rai-w1-08` on port 54330, created empty for this record and removed after the PR opened. Proves A01 (local), A02, A07. This ticket writes no product code: it runs the W1-INT suite and the exit negatives from a clean checkout, records command, output and fixture identity, and flips the W1/M1 gates. No decision is recorded or resolved; D07-D10 untouched; the frozen source spec untouched.

**Fixture set: `fixture set slice1-synthetic@1 7c80ccd43663`** — the line `npm run fixtures:load` printed into the empty database (section 2), the identity every browser spec and the negatives suite reload before each test (`rai-web/fixtures/src/data/manifest.json`; provenance and per-fixture identities in [rai-web/fixtures/src/data/README.md](../../rai-web/fixtures/src/data/README.md)). Fixture identities cited below: users `fx-user-owner-cm` (owns all five fixture cases), `fx-user-owner-cm-2` (owns none), `fx-user-spoc-cm` (BU SPOC of CM), `fx-user-dpo`, `fx-user-ai-coe`, `fx-user-it-security`, `fx-user-admin`, `fx-user-dpo-spoc-hr` (dual-role); cases `fx-case-nonvendor` (RAI-2000-0001, CM), `fx-case-vendor` (RAI-2000-0002, HR), `fx-case-missing-slot` (RAI-2000-0003, CM), `fx-case-na-reasons` (RAI-2000-0004, HR), `fx-case-hr-dualrole` (RAI-2000-0005, HR).

This record holds (1) the environment, (2) the clean-checkout install, migration and fixture load, (3) the automated suites with their exact output, (4) the W1 exit negatives run explicitly against the built server, (5) the restart journey run by hand outside the suite, (6) the manual Google sign-in (pending Ta), (7) the A-ID evidence table against every clause of the W1 exit evidence in BUILD_PLAN and the work breakdown, (8) known limitations, (9) the gate changes this PR makes and (10) the tracker actions.

## 1. Environment

| Item | Value |
|---|---|
| Node / npm | v24.21.0 / 11.19.0 (`export PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH`) |
| Postgres | `POSTGRES_PORT=54330 docker compose -p rai-w1-08 up -d --wait` from the worktree root → `Container rai-w1-08-postgres-1 Healthy`, `127.0.0.1:54330->5432/tcp`; image `postgres:16.15-alpine`; fresh volume (no earlier W1-08 container, branch or worktree existed) |
| `rai-web/.env` | `.env.example` with every `54320` replaced by `54330` (`DATABASE_URL`, `DATABASE_MIGRATE_URL`, `POSTGRES_PORT`); nothing else changed; not committed |
| Checkout | `git worktree add /Users/tkhongsap/github/rai-wt/W1-08 -b codex/w1-08-w1-exit origin/main`; `git status` clean before the first command |
| Playwright | Chromium already installed on this machine (`chromium-1243`); no install step was needed |
| Shell for the by-hand sections | zsh; every command run from `rai-web/` unless the row says otherwise |

## 2. Clean checkout: install, migrate from an empty database, load the fixture set

```text
$ npm ci
added 442 packages, and audited 448 packages in 3s
174 packages are looking for funding
4 moderate severity vulnerabilities
exit 0   (exact versions from package-lock.json; nothing added or bumped)

$ npm run migrate
> tsx --conditions=rai-source server/src/db/migrate.ts
migrate: applied 4 migration(s), 0 already applied

$ npm run fixtures:load
> tsx --conditions=rai-source fixtures/src/load.ts
fixtures:load: fixture set slice1-synthetic@1 7c80ccd43663
fixtures:load: published configuration revisions: checklist_templates, sla, calendar, operator_recipients, use_case_groups
fixtures:load: 5 cases, 5 open drafts, 45 slot rows, 33 artifacts; 33 objects written, 0 already present under .local/blobs
fixtures:load: 33 documents in the set; correlation id 71898a0c-cb54-4841-ad39-a13587fd908c
```

The `npm audit` count is npm's advisory summary over dev dependencies; no dependency was changed by this ticket (none may be: it writes no code). The database held the fixture set `slice1-synthetic@1`, manifest hash `7c80ccd43663b2d17b96bcfb3db87c5e65860cf851dd6e2930fc064536544f80` (row in `fixture_set`), before any suite ran.

## 3. Automated suites — commands and exact output

All from `rai-web/` on the checkout above, in this order, each exit 0.

| Command | Output (verbatim tail) |
|---|---|
| `npm run verify` (= `npm run lint && npm run typecheck && npm test`) | lint: `eslint .` silent; `Checking formatting... All matched files use Prettier code style!`; `check-css: no outline removal outside :focus-visible`. typecheck: `tsc -b` silent. `test:unit`: `ℹ tests 347 / ℹ suites 13 / ℹ pass 347 / ℹ fail 0 / ℹ cancelled 0 / ℹ skipped 0 / ℹ todo 0 / ℹ duration_ms 2312.112333`. `test:integration`: `ℹ tests 135 / ℹ suites 26 / ℹ pass 135 / ℹ fail 0 / ℹ cancelled 0 / ℹ skipped 0 / ℹ todo 0 / ℹ duration_ms 58750.265084` |
| `npm run build && npm run check:substitute-absent` | `@rai/shared build` → `@rai/web build`: `dist/index.html 0.50 kB`, `dist/assets/index-CU_hk2GE.css 12.14 kB`, `dist/assets/index-C1q_jwrW.js 401.42 kB`, `✓ built in 261ms` → `@rai/server build`; `check-substitute-absent: scanned 391 files, 0 with the marker` |
| `npm run test:browser` (= `test:browser:server` then `test:browser:substitute`) | evidence configuration (`tests/browser/playwright.config.ts`, builds and starts `node server/dist/main.js` in fixture mode on 8788 against port 54330): **`108 passed (1.3m)`** — 36 tests × desktop-1440, tablet-834, phone-390: `w1-12-harness.spec.ts` 7, `w1-int-06-case-pack-versions.spec.ts` 7, `w1-int-07-shell-sign-in-cases.spec.ts` 19, `w1-int-evidence-config.spec.ts` 1, `w1-int-journey.spec.ts` 2; no flaky, no skipped. Substitute configuration (Lane B development, `playwright.substitute.config.ts`; **never evidence**): `78 passed (45.9s)` |

Repository-root checks, from the worktree root:

```text
$ node --test tests/*.test.mjs
ℹ tests 22
ℹ pass 22
ℹ fail 0
$ node scripts/check-links.mjs
check-links: 140 Markdown files, 676 relative links checked, 0 broken        (before this ticket's documents; rerun after them in section 9)
$ node scripts/check-frozen-source.mjs
check-frozen-source: docs/product/source-spec.md sha256 92c4f7123058b8fec3c2ba7abdf10538fad034778624b0675975b39de440b354 matches docs/sources.md row 1 (ideas/ai-console-platform-plan.md)
$ node --test scripts/*.test.mjs
ℹ tests 18
ℹ pass 18
ℹ fail 0
$ git diff --check
(clean, exit 0)
```

The W1-INT tests inside `npm run test:integration`, as the runner printed them (each `✔`):

```text
▶ W1-INT exit negatives (A01) over HTTP against the real server process — fixture set slice1-synthetic@1 7c80ccd43663
  ✔ no session: the API and a direct artifact URL (a copied link) answer 401 with the envelope; no bytes are served (31.829875ms)
  ✔ wrong role: each reviewer and the Admin can read a case but is 403 on create, draft write, upload and submit (W0-05 role rows) (63.67675ms)
  ✔ other BU: the CM SPOC is 403 on an HR case for read, draft, write, upload, submit, versions and its artifact, and the HR cases are absent from its list; the owner of nothing sees nothing (54.152625ms)
  ✔ unsafe upload: a disguised executable is refused 422 unsafe_upload (type_not_allowed), nothing is stored, the filename is not echoed (51.961417ms)
▶ W1-INT exit negatives: local-google fails closed (W0-03 S1, S2; exit 78, never listening)
  ✔ a non-loopback bind and an unknown mode each exit 78 with the reason code before any port is bound (1442.054625ms)
▶ W1-INT graceful shutdown is bounded
  ✔ SIGTERM exits 0 within the drain budget while a connected socket that never sent a byte is held open
  ✔ a request in flight at SIGTERM is answered before the process exits
  ✔ stop() escalates to SIGKILL after the grace period and rejects with the captured lines
▶ W1-INT: no evidence test imports the substitute
  ✔ every real-server browser spec and integration test, and everything it reaches under tests/, imports nothing of the W1-13 substitute
  ✔ the substitute-side files are exactly the ones the substitute configuration owns (a control for the scan)
▶ W1-INT: the evidence configuration cannot load the substitute
  ✔ playwright.config.ts ignores *.substitute.spec.ts, starts the built deployable only and sets no substitute variable
  ✔ the product source reads no substitute variable and imports no substitute module
  ✔ the real server process started with every substitute-shaped variable set ignores them: no marker header, no reset hook, no banner flag
▶ W1-05 restart proof (A07) — fixture set slice1-synthetic@1 7c80ccd43663, fx-user-owner-cm
  ✔ create → upload → attach → submit, SIGTERM, a new process on the same database and blob directory: the case and the version reopen unchanged; the artifact downloads with the stored hash; the replay under the original key still answers
```

The W1-INT journey and positive inside `npm run test:browser:server`, as Playwright printed them at desktop-1440 (identical lines at tablet-834 and phone-390):

```text
✓ tests/browser/w1-int-journey.spec.ts:140:3 › W1-INT journey on the real server: create → attach → submit → restart → reopen (fixture set slice1-synthetic@1 7c80ccd43663; fx-user-owner-cm) › the owner creates, attaches and submits through the UI; the API process is stopped and restarted; the case, the version and the artifact bytes reopen unchanged
✓ tests/browser/w1-int-journey.spec.ts:355:3 › W1-INT BU SPOC on behalf on the real server (fixture set slice1-synthetic@1 7c80ccd43663; fx-user-spoc-cm submits fx-case-nonvendor owned by fx-user-owner-cm) › the SPOC of the owner's BU submits the owner's fixture case: the submit audit event names the SPOC as actor and the case owner is unchanged
✓ tests/browser/w1-int-evidence-config.spec.ts:33:3 › W1-INT evidence configuration: the built server ignores every substitute flag › with VITE_API_SUBSTITUTE=true and the other substitute variables in its environment the built server serves the product bundle and the real API only
✓ tests/browser/w1-int-07-shell-sign-in-cases.spec.ts:146:5 › … › fx-user-owner-cm lands on its scoped list: 5 fixture cases present, 0 absent
✓ … › fx-user-owner-cm-2 lands on its scoped list: 0 fixture cases present, 5 absent
✓ … › fx-user-spoc-cm lands on its scoped list: 2 fixture cases present, 3 absent
✓ … › fx-user-ai-coe / fx-user-dpo / fx-user-it-security / fx-user-admin / fx-user-dpo-spoc-hr lands on its scoped list: 5 fixture cases present, 0 absent   (five lines)
✓ tests/browser/w1-int-06-case-pack-versions.spec.ts:126:3 › … › every slot state and reason is reachable by keyboard, the N/A reason cannot be skipped, and a save persists
✓ tests/browser/w1-int-06-case-pack-versions.spec.ts:345:3 › … › submit freezes the pack; version navigation shows the versions the server serves, read-only
✓ tests/browser/w1-int-06-case-pack-versions.spec.ts:408:3 › … › forbidden and unauthenticated answers are rendered as received; no client-side rule decides access
```

## 4. W1 exit negatives, run explicitly against the built server

### 4.1 `local-google` fails closed (W0-03 S1, S2; also S3 and S4 for completeness)

The built deployable, `node server/dist/main.js`, with `rai-web/.env` loaded (`set -a; . ./.env; set +a`) and the named variables overridden; `LOG_PRETTY=false` so the refusal line is the raw JSON. Nothing listened on 8787 after any run (`lsof -iTCP:8787 -sTCP:LISTEN` empty).

```text
$ HOST=0.0.0.0 RAI_IDENTITY_MODE=local-google RAI_IDENTITY_GOOGLE_CLIENT_ID=x RAI_IDENTITY_GOOGLE_CLIENT_SECRET=x node server/dist/main.js
{"event":"process.refused","reason":"bind_not_loopback"}
exit=78

$ HOST=127.0.0.1 RAI_IDENTITY_MODE=bogus node server/dist/main.js
{"event":"process.refused","reason":"mode_unknown"}
exit=78

$ HOST=127.0.0.1 RAI_IDENTITY_MODE= node server/dist/main.js            (missing mode)
{"event":"process.refused","reason":"mode_unknown"}
exit=78

$ HOST=127.0.0.1 PUBLIC_BASE_URL=http://desk.example.test:8787 RAI_IDENTITY_MODE=local-google RAI_IDENTITY_GOOGLE_CLIENT_ID=x RAI_IDENTITY_GOOGLE_CLIENT_SECRET=x node server/dist/main.js   (S3)
{"event":"process.refused","reason":"base_url_not_loopback"}
exit=78

$ HOST=127.0.0.1 RAI_IDENTITY_MODE=local-google node server/dist/main.js   (client id/secret left at the .env.example placeholders; S4/S15)
{"event":"process.refused","reason":"secret_missing:RAI_IDENTITY_GOOGLE_CLIENT_ID"}
exit=78
```

The `0.0.0.0` run exercises W0-03 S2 (refused before `listen`), as the spec's section 5 says it does; S16 (post-listen address check) is proved by ID-02 in `rai-web/server/src/identity/adapter.test.ts` inside `npm run test:unit`, not by this run. The dummy client values `x` prove only that the bind check fires before the client is used; the placeholder run proves a forgotten placeholder is a refusal, never an empty secret.

### 4.2 Wrong role, other BU, direct file URL, unsafe upload (over HTTP, `curl`)

The business tables were emptied (`TRUNCATE … RESTART IDENTITY CASCADE` as `rai_owner`) and the fixture set reloaded (`npm run fixtures:load` → `fixture set slice1-synthetic@1 7c80ccd43663`, `5 cases, 5 open drafts, 45 slot rows, 33 artifacts; 33 objects written`) so the by-hand run started from the fixture state after the suites. Then the built server in fixture mode: `NODE_ENV=test RAI_IDENTITY_MODE=fixture HOST=127.0.0.1 PORT=8790 PUBLIC_BASE_URL=http://127.0.0.1:8790 LOG_PRETTY=false node server/dist/main.js` → `Server listening at http://127.0.0.1:8790`, `process.started … "identityMode":"fixture","loopback":true`. Sessions come from `POST /auth/fixture/sign-in {"fixtureUserId": …}` (200, `Set-Cookie`), never fabricated. Case ids: `fx-case-nonvendor` = `7bb39ef3-0f64-8f18-b35f-096d8b20ba86` (CM), `fx-case-vendor` = `622397f7-1ba8-8ee6-b1b2-7665e81383cc` (HR); `{CMDOC}` = `92553dfc-…` (Architecture_Overview.pdf of the CM case), `{HRDOC}` = `108b9014-…` (an HR-case document). Every `curl` carried `sec-fetch-site: same-origin`.

**Direct file URL without a session (A01 direct-file negative)**

```text
$ curl -i http://127.0.0.1:8790/api/artifacts/{CMDOC}
HTTP/1.1 401 Unauthorized
content-type: application/json; charset=utf-8
{"error":{"code":"unauthenticated","messageKey":"error.unauthenticated","correlationId":"cd50fa82-b148-4860-be19-ee493da84610"}}
    (no Content-Disposition header, no bytes)
$ curl http://127.0.0.1:8790/api/artifacts/{CMDOC}/meta            → same envelope, HTTP 401
$ curl http://127.0.0.1:8790/api/cases                              → same envelope, HTTP 401
$ curl --cookie '__Host-rai_session=<32 random bytes>' http://127.0.0.1:8790/api/artifacts/{CMDOC}   (forged cookie)
{"error":{"code":"unauthenticated","messageKey":"error.unauthenticated","correlationId":"e8b9dcd7-ffd3-4f9c-9c7d-b1fe920b6102"}}
HTTP 401
```

**Wrong role (A01)** — each reviewer and the Admin, signed in through the fixture route (`sign-in fx-user-dpo -> 200`, `fx-user-ai-coe -> 200`, `fx-user-it-security -> 200`, `fx-user-admin -> 200`); identical results for all four:

```text
GET  /api/cases/{CM}                -> 200                                  (all_cases scope reads)
POST /api/cases                     -> {"error":{"code":"forbidden","messageKey":"error.forbidden","correlationId":"…"}} HTTP 403
PUT  /api/cases/{CM}/draft          -> {"error":{"code":"forbidden",…}} HTTP 403
POST /api/cases/{CM}/artifacts      -> {"error":{"code":"forbidden",…}} HTTP 403
POST /api/cases/{CM}/draft/submit   -> {"error":{"code":"forbidden",…}} HTTP 403
```

**Other BU (A01)** — `fx-user-spoc-cm` (BU SPOC of CM) on the HR case, then `fx-user-owner-cm-2` (owns nothing):

```text
sign-in fx-user-spoc-cm -> 200
GET  /api/cases?pageSize=100            -> 200: 2 cases: RAI-2000-0003 (Consumer Mobile), RAI-2000-0001 (Consumer Mobile)     (the three HR cases absent)
GET  /api/cases/{CM}                    -> 200 (in scope)
GET  /api/cases/{HR}                    -> {"error":{"code":"forbidden","messageKey":"error.forbidden","correlationId":"01a57cb0-…"}} HTTP 403
GET  /api/cases/{HR}/draft              -> 403
PUT  /api/cases/{HR}/draft              -> 403
POST /api/cases/{HR}/artifacts          -> 403
POST /api/cases/{HR}/draft/submit       -> 403
GET  /api/cases/{HR}/versions           -> 403
GET  /api/artifacts/{HRDOC}             -> 403
GET  /api/artifacts/{HRDOC}/meta        -> 403
GET  /api/artifacts/{CMDOC}/meta        -> 200 (in scope)
sign-in fx-user-owner-cm-2 -> 200
GET  /api/cases?pageSize=100            -> 200: 0 cases; total=0
GET  /api/cases/{CM}                    -> 403
GET  /api/cases/00000000-0000-4000-8000-000000000000 (unknown id, scoped actor)      -> 403
GET  /api/cases/00000000-0000-4000-8000-000000000000 as fx-user-dpo (all_cases)      -> {"error":{"code":"not_found","messageKey":"error.not_found","correlationId":"2df16e7f-…","details":{"resource":"case"}}} HTTP 404
```

(The first attempt at the two list calls failed in the shell, not on the server — zsh expanded the unquoted `?`; the quoted rerun is what is shown.)

**Unsafe upload (W0-08)** — `fx-user-owner-cm` (sign-in 200) on its own CM case, three disguised executables declared `application/pdf`: a PE stub (`MZ…`) named `report.pdf`, an ELF stub (`\x7fELF…`) named `report.docx`, a shell script (`#!/bin/sh`) named `notes.pdf`:

```text
POST /api/cases/{CM}/artifacts report.pdf  -> {"error":{"code":"unsafe_upload","messageKey":"error.unsafe_upload","correlationId":"8f82212b-…","details":{"reasonKey":"error.unsafe_upload.type_not_allowed"}}} HTTP 422
POST /api/cases/{CM}/artifacts report.docx -> {"error":{"code":"unsafe_upload",…,"details":{"reasonKey":"error.unsafe_upload.type_not_allowed"}}} HTTP 422
POST /api/cases/{CM}/artifacts notes.pdf   -> {"error":{"code":"unsafe_upload",…,"details":{"reasonKey":"error.unsafe_upload.type_not_allowed"}}} HTTP 422
artifact rows for the CM case before=7 after=7 (nothing stored)
upload.rejected log lines: 3        filename in the server log: 0
control: a genuine PDF from the same actor -> 201
```

## 5. The restart journey by hand, outside the suite (A07)

The suite runs the restart only in spawned-process tests (`w1-05-restart.test.ts`, `w1-int-journey.spec.ts`), so it was run once more by hand over the API against the same built server on 8790 (pid 10336 at the start; fixture mode; `DATABASE_URL` on 54330; `BLOB_DIR ./.local/blobs`), actor `fx-user-owner-cm` with a session cookie from the fixture sign-in route. (A first attempt used a wrong `sourceRecordId` shape and was refused `422 invalid_input` at `body.sourceRecordId.kind` before anything was written; the run below is the complete one.)

```text
$ POST /api/cases  (owner; non-vendor; known source id TPM-2026-0042)
HTTP 201
{"caseId":"01a0c6c4-125e-7622-a071-1358d337d2d6","registryId":"RAI-2026-0001","status":"draft","sourceRecordId":{"kind":"known","value":"TPM-2026-0042"},"vendorInvolved":false,"caseRevision":1}
$ GET /api/cases/{caseId}/draft
HTTP 200
{"draftId":"01a0c6c4-125e-75a6-946b-6daaadac2248","versionNumber":1,"draftRevision":1,"checklistTemplateVersion":"v1.0 Sheet3","stageContext":"idea","slot3":{"state":"not_applicable","reason":{"kind":"default_non_vendor"}},"slot4":{"state":"not_applicable","reason":{"kind":"default_non_vendor"}},"slot1":{"state":"missing"}}
$ POST /api/cases/{caseId}/artifacts  (synthetic PDF probe.pdf, 2585 bytes, sha256 cd9f158ec8f4461e8681fafb1873b92cdedafda93cb9fc763a97b7d7fb0489dc)
HTTP 201
{"artifactId":"01a0c6c4-131d-7dee-a077-de258db0b134","caseId":"01a0c6c4-125e-7622-a071-1358d337d2d6","sha256":"cd9f158ec8f4461e8681fafb1873b92cdedafda93cb9fc763a97b7d7fb0489dc","filename":"probe.pdf","mediaType":"application/pdf","sizeBytes":2585,"uploadedBy":"fixture:fx-user-owner-cm","uploadedAt":"2026-09-22T01:38:53.853Z"}
$ PUT /api/cases/{caseId}/draft  (slot 1 attached, slot 2 not_yet, slot 5 N/A with a typed Thai reason, slot 7 not_yet)
HTTP 200      draftRevision 1 -> 2
$ POST /api/cases/{caseId}/draft/submit   (Idempotency-Key, expectedVersion {draftId, 2})
HTTP 201
{"versionId":"01a0c6c4-125e-75a6-946b-6daaadac2248","versionNumber":1,"submittedBy":"fixture:fx-user-owner-cm","configurationRevisionId":"01a0c6c0-7b69-771c-b7db-3d7169ed91ce","laneMappingVersion":"lane-mapping/v1","checklistTemplateVersion":"v1.0 Sheet3","stageContext":"idea","slots":{"1":"attached:01a0c6c4","2":"not_yet","3":"not_applicable:default_non_vendor","4":"not_applicable:default_non_vendor","5":"not_applicable:text","6":"missing","7":"not_yet","8":"missing","9":"missing"}}
$ GET /api/cases/{caseId}, /versions, /versions/latest, /versions/{versionId}, /api/artifacts/{artifactId}/meta   -> HTTP 200 ×5   (bodies saved: sha256 1d51131f8d6642a194d5fdbc13de6ebc1779fd64f9d516557603cd16c60392f0)
$ GET /api/artifacts/{artifactId}                                                                                 -> HTTP 200, 2585 bytes, sha256 cd9f158e… (= the upload)
$ PUT /api/cases/{caseId}/draft with expectedVersion = the submitted version   (a second write to the frozen version)
{"error":{"code":"stale_version","messageKey":"error.stale_version","correlationId":"58b5d235-…","details":{"reason":"version_superseded","guidanceKey":"error.stale_version.guidance.version_superseded","current":{"versionId":"01a0c6c4-125e-75a6-946b-6daaadac2248","versionNumber":1,"revision":3,"state":"submitted","ready":false},"refreshPath":"/cases/01a0c6c4-125e-7622-a071-1358d337d2d6"}}}
HTTP 409
$ kill -TERM 10336
  process exited      "event":"process.stopping","processId":"bf2eeddf-ef4a-4f5e-a2fb-0ff44dc3b636","fields":{"signal":"SIGTERM"}
$ curl http://127.0.0.1:8790/api/session            -> curl exit 7 (connection refused; nothing listens)
$ node server/dist/main.js   (a NEW process, same PORT, DATABASE_URL and BLOB_DIR)
  old pid 10336 processId bf2eeddf-… -> new pid 10642 processId a4508140-58b9-459f-8dc8-d1daa11355b3
$ the same five GETs with the same session cookie (the session row is in Postgres)    -> HTTP 200 ×5   sha256 1d51131f8d6642a194d5fdbc13de6ebc1779fd64f9d516557603cd16c60392f0
  five bodies byte-identical before/after (cmp): yes
$ GET /api/artifacts/{artifactId} after the restart   -> HTTP 200, 2585 bytes, sha256 cd9f158ec8f4461e8681fafb1873b92cdedafda93cb9fc763a97b7d7fb0489dc
  downloaded bytes identical to the uploaded probe.pdf (cmp): yes
$ psql (read only): select action, actor_subject_id, actor_role from audit_event where target_case_id = {caseId} order by seq
case.created|fixture:fx-user-owner-cm|owner
artifact.uploaded|fixture:fx-user-owner-cm|owner
draft.saved|fixture:fx-user-owner-cm|owner
version.submitted|fixture:fx-user-owner-cm|owner
artifact.downloaded|fixture:fx-user-owner-cm|owner      (×2: before and after the restart)
$ psql as rai_owner: update pack_version set stage_context='idea' where id = {versionId}
ERROR:  rai.frozen_version
DETAIL:  a submitted pack_version is immutable except ready_at once (W0-06 9.2)
$ psql as rai_app: the same UPDATE
ERROR:  rai.frozen_version
DETAIL:  a submitted pack_version is immutable except ready_at once (W0-06 9.2)
```

The two `cmp` results are over the five bodies of this run; the capture file also held the five `403` bodies of the aborted first attempt (their only difference is the per-request `correlationId`), which is why the first whole-file `cmp` printed `NO` before the comparison was narrowed. The restarted process was then stopped with SIGTERM (`process exited`).

## 6. Google sign-in on loopback — manual, pending Ta

**Not recorded as passed.** The manual sign-in through `local-google` on a loopback bind with a Google account is a human step outside CI, and this record was produced by the delegated flow without a Google OAuth client. The runbook is in [TESTING.md, "Google sign-in on loopback (manual, W1-08)"](../../TESTING.md#google-sign-in-on-loopback-manual-w1-08): create a local OAuth client, set `RAI_IDENTITY_GOOGLE_CLIENT_ID` and `RAI_IDENTITY_GOOGLE_CLIENT_SECRET` in the local `.env` only, start the built server on `127.0.0.1`, sign in, and record only the line below with the date. No account address is ever recorded.

```text
Google sign-in on loopback: pending Ta
```

When Ta has run it, the line becomes `Google sign-in on loopback: pass — <date>` here and in the DEVLOG M1 entry, and the BUILD_PLAN W1 cell drops "(Google loopback sign-in pending Ta)". Every automated `local-google` obligation of W0-03 (S1-S4, S13-S18 in `server/src/config.test.ts` and `server/src/identity/adapter.test.ts`; S1, S2 with the real process in `w1-01-startup-refusals.test.ts` and `w1-int-negatives.test.ts`; the built server by hand in section 4.1) is recorded above.

## 7. A-ID evidence table

The W1 exit evidence, clause by clause, as [BUILD_PLAN W1](../../BUILD_PLAN.md#w1--scoped-case-and-versioned-pack) and the [work breakdown](../../docs/delivery/slice-1-work-breakdown.md) state it. Every test named ran green in section 3 (`npm run verify` for `tests/integration/**` and `server/src/**`; `npm run test:browser:server` for `tests/browser/*.spec.ts`), and every by-hand item is quoted in sections 4 and 5. Test names are the executed names the runner printed.

| Clause | A-ID | Automated evidence (file › test) | By hand (this record) |
|---|---|---|---|
| Local-role access: each fixture user, including the dual-role identity, signs in and receives its (role, scope) pairs; scope is enforced server-side only | A01 | `tests/integration/w1-01-fixture-sign-in.test.ts` › `ID-03 every fixture user signs in through the fixture provider and receives exactly its (role, scope) pairs`, › `ID-08 a request without a session is unauthenticated; a wrong-role request is forbidden by the middleware, not the adapter`; `tests/browser/w1-int-07-shell-sign-in-cases.spec.ts` › `<each of the 8 fixture users> lands on its scoped list: N fixture cases present, M absent` (8 tests × 3 widths), › `no client-side check decides access: a reviewer reaches the form and the server's 403 is rendered`; `tests/browser/w1-int-06-case-pack-versions.spec.ts` › `forbidden and unauthenticated answers are rendered as received; no client-side rule decides access` | 4.2 sign-ins 200 for the seven users used |
| Wrong role fails safely | A01 | `tests/integration/w1-int-negatives.test.ts` › `wrong role: each reviewer and the Admin can read a case but is 403 on create, draft write, upload and submit (W0-05 role rows)`; `w1-02-cases.test.ts` › `T10: reviewer-dpo and Admin are 403 role on create and edit…`; `w1-03-artifact-upload-download.test.ts` › `T10: reviewers and Admin hold no artifact.upload row…`; `w1-04-pack-draft.test.ts` › `T10: reviewer-dpo and admin may read the draft but never save it…`; `w1-05-submit.test.ts` › `403 role for reviewer-dpo and admin (T10)…` | 4.2 wrong role: 200 read, 403 ×4 for each of `fx-user-dpo`, `fx-user-ai-coe`, `fx-user-it-security`, `fx-user-admin` |
| Other BU fails safely (read, list, write) | A01 | `w1-int-negatives.test.ts` › `other BU: the CM SPOC is 403 on an HR case for read, draft, write, upload, submit, versions and its artifact, and the HR cases are absent from its list; the owner of nothing sees nothing`; `w1-02-cases.test.ts` › `T3 / T5: another owner and a SPOC of another BU are 403 scope on read…`, › `T8: owner-b sees none of owner-a's cases; spoc-b1 sees B1 only…`, › `T6: spoc-b1 creating a case in B2 is 403 scope…`, › `T11 (edit): owner-b on owner-a's draft is 403 scope…`, › `T33 (case.view): a random UUID is 403 scope for owner-b and spoc-b1…; 404 not_found resource case for reviewer-dpo and Admin`; `w1-03-artifact-upload-download.test.ts` › `T11: another owner and an out-of-BU SPOC are 403 scope on upload and download…`, › `T33: an unresolvable artifact or case id is 403 scope for an own/BU-only caller and 404 artifact only for an all_cases holder`; `w1-04-pack-draft.test.ts` › `T11: owner-b on owner-a's case and spoc-cm on an HR case: 403 scope on GET and PUT…`; `w1-int-07-shell-sign-in-cases.spec.ts` › `fx-user-spoc-cm lands on its scoped list: 2 fixture cases present, 3 absent`, › `fx-user-owner-cm-2 …: 0 present, 5 absent` | 4.2 other BU: list 2 CM cases only; 403 ×9 on the HR case and its artifact; owner-cm-2 list empty, 403 on CM and on an unknown id; 404 `resource: case` only for the DPO |
| Direct file URL without an authorized session is refused; the blob directory is never served | A01 | `w1-03-artifact-upload-download.test.ts` › `T12 / A01: a direct file URL without a session is 401 on the bytes, the metadata and the upload; the blob directory is not routable`; `w1-int-negatives.test.ts` › `no session: the API and a direct artifact URL (a copied link) answer 401 with the envelope; no bytes are served`; `w1-02-cases.test.ts` › `401 unauthenticated on every route without a session; nothing else runs` | 4.2 direct file URL: 401 on bytes, `/meta` and list; forged cookie 401; no `Content-Disposition` |
| All slot dispositions (attached, not yet, missing, N/A with reason); reasons required | A02 | `w1-04-pack-draft.test.ts` › `all four slot states save in one PUT and read back; draftRevision + 1…`, › `a missing, empty or blank reason on N/A is 422 validation.reason_required…`, › `GET returns the 7.5 PackDraft: nine slots, the fixture dispositions, the default reason on the non-vendor case, the explicit text reason distinct from it`; `w1-int-06-case-pack-versions.spec.ts` › `every slot state and reason is reachable by keyboard, the N/A reason cannot be skipped, and a save persists`, › `the slot dialog contains focus, closes on Escape, and asks before discarding an unsaved reason`; `w1-int-journey.spec.ts` › the journey (slot 1 attached, 2 not yet, 5 N/A typed reason, 7 not yet, frozen as set) | 5: draft saved with attached / not_yet / not_applicable(text) / missing and frozen as `{"1":"attached…","2":"not_yet","5":"not_applicable:text","6":"missing",…}` |
| Non-vendor defaults: slots 3 and 4 N/A only when `vendor_involved` is false; `Unknown` and known source ids | A02 | `w1-02-cases.test.ts` › `vendorInvolved and modelType are stored as desk-local fields…; slots 3 and 4 default to N/A only when no vendor is involved`, › `a case with Unknown source saves as the literal Unknown…`, › `a known TPM-… or VRO-… value is stored and read back unchanged…`, › `the external register is never called…`; `w1-04-pack-draft.test.ts` › `slots 3 and 4 are never N/A by default on the vendor fixture case`, › `create with vendorInvolved false defaults slots 3 and 4 to N/A default_non_vendor; with true every slot is missing…`, › `default_non_vendor is accepted only on slot 3 or 4 of a non-vendor case…`; `w1-int-07-shell-sign-in-cases.spec.ts` › `an unknown business unit key is the server's 422; a valid form creates a draft and lands on the list`; `w1-int-journey.spec.ts` › the journey creates a non-vendor case with a known source id | 5: `vendorInvolved:false` → draft `slot3`/`slot4` `not_applicable / default_non_vendor`; `sourceRecordId {"kind":"known","value":"TPM-2026-0042"}` read back unchanged |
| Submitted bytes cannot be overwritten (immutable version; second write rejected) | A07 | `w1-05-submit.test.ts` › `201 SubmittedVersion: the draft row becomes the version, the artifact references are embedded, the configuration revision id and the lane-mapping version are recorded…`, › `UPDATE artifact_slot SET artifact_id = … WHERE version_id = <submitted> raises rai.frozen_version as rai_app and as rai_owner; so does every other slot or version write; the rows are unchanged`, › `after submit the case has no open draft: GET /draft is 404, PUT /draft is 409 version_superseded pointing at the version, an upload is 422 no_open_draft, a second submit is 409 version_superseded`, › `list is empty before submit…; after submit… latest and by-id return the same body, byte-identical on every read`; `w1-04-pack-draft.test.ts` › `naming a version that is not the open draft is 409 version_superseded…`; `w1-03-artifact-upload-download.test.ts` › `A07: downloaded bytes match the stored hash…`; `w1-int-06-case-pack-versions.spec.ts` › `submit freezes the pack; version navigation shows the versions the server serves, read-only` | 5: PUT against the frozen version `409 stale_version / version_superseded`; `UPDATE pack_version` as `rai_owner` and as `rai_app` → `ERROR: rai.frozen_version` |
| The same case reopens after restart (create, attach, submit, restart, reopen; data survives) | A07 | `w1-05-restart.test.ts` › `create → upload → attach → submit, SIGTERM, a new process on the same database and blob directory: the case and the version reopen unchanged; the artifact downloads with the stored hash; the replay under the original key still answers`; `w1-int-journey.spec.ts` › `the owner creates, attaches and submits through the UI; the API process is stopped and restarted; the case, the version and the artifact bytes reopen unchanged` (3 widths); `w1-int-shutdown.test.ts` › `SIGTERM exits 0 within the drain budget…` | 5: pid 10336 SIGTERMed, connection refused, pid 10642 started; five bodies byte-identical (sha256 `1d51131f…` both sides); download sha256 `cd9f158e…` = upload |
| Unsafe uploads fail safely | (W0-08; A01 exit clause) | `w1-03-artifact-upload-download.test.ts` › `an executable disguised by extension is rejected with unsafe_upload type_not_allowed: nothing stored, no audit row, one upload.rejected line without the filename`; `w1-03-hostile-set.test.ts` › `every W0-08 8.6 byte-level hostile row is refused at the route with its reason and nothing is stored; the accepted rows land`, › `W0-08 8.6 pack total: … the seventh is pack_total_exceeded at check 10`; `w1-int-negatives.test.ts` › `unsafe upload: a disguised executable is refused 422 unsafe_upload (type_not_allowed), nothing is stored, the filename is not echoed` | 4.2 unsafe upload: PE, ELF and shell stubs → `422 unsafe_upload / type_not_allowed`; artifact rows 7 → 7; 3 `upload.rejected` lines, 0 filenames in the log; genuine PDF 201 |
| `local-google` refuses a non-loopback bind and an unknown mode (fail-closed, W0-03) | A01 (W0-03 S1, S2) | `server/src/config.test.ts` › `local-google refuses a non-loopback bind host before listen (W0-03 S2, W0-02 section 5 HOST row)`, › `an unknown or missing identity mode refuses to start (S1) without distinguishing the two`, › `a misconfiguration is a start-up failure with a code naming the variable, never a default`; `tests/integration/w1-01-startup-refusals.test.ts` › `local-google refuses to start on a non-loopback bind (S2) and on an unknown mode (S1), exit 78, never listening`; `w1-int-negatives.test.ts` › `a non-loopback bind and an unknown mode each exit 78 with the reason code before any port is bound` | 4.1: `HOST=0.0.0.0` → `{"event":"process.refused","reason":"bind_not_loopback"}` exit 78; `RAI_IDENTITY_MODE=bogus` → `mode_unknown` exit 78; missing mode, non-loopback base URL and placeholder client likewise |
| One manual Google sign-in through `local-google` on a loopback bind passes (human, outside CI; client local, never committed; no address recorded) | A01 (W0-03 ID-14) | — (manual by design) | **pending Ta** (section 6; runbook in TESTING.md) |
| BU SPOC submits on the owner's behalf; the audit event names the SPOC, the owner is unchanged (W1-INT positive) | A01, A07 | `w1-int-journey.spec.ts` › `the SPOC of the owner's BU submits the owner's fixture case: the submit audit event names the SPOC as actor and the case owner is unchanged`; `w1-05-submit.test.ts` › `a BU SPOC submitting on the owner behalf is recorded as itself; the case owner is unchanged (W0-05 case.submit, T4)` | — |
| Record the command, output and fixture identity | — | sections 2-5 of this record; fixture set `slice1-synthetic@1 7c80ccd43663` on every output | — |

## 8. Known limitations — what W1 does not claim

- **No lanes, no reviews, no QC, no notifications.** Submit freezes a version and sets the three lane projections to `pending`; nothing opens a lane (W2-01), decides (W2-02), sends back (W2-03) or resubmits (W2-04). QC exists only as the W1-10 substitute bound at the integration layer; no finding is produced or shown (W2/W4). No mail is sent anywhere: slice 1 has the W1-11 sink only, and no transport value exists until W7 authorizes one.
- **Substitute runs are never evidence.** The `78 passed` of `npm run test:browser:substitute` and every `*.substitute.spec.ts` prove Lane B development against the W1-13 in-memory substitute, not the product. Only `npm run test:browser:server` and the integration suite against the real Postgres count, and `w1-int-substitute-absent.test.ts` plus `check-substitute-absent` prove the deployable and the evidence configuration carry none of it.
- **Identity is proved in `fixture` and fail-closed `local-google` only.** The positive `local-google` path (a real Google account on loopback) is the pending manual step in section 6. `network` and `production` modes are proved only to refuse to start without their credentials; no networked or production identity is claimed (W8, D10).
- **Synthetic data only.** Every case, document, user and address is the W0-08 fixture set (`RAI-DESK-SYNTHETIC-FIXTURE` sentinel; `rai-desk.example` addresses; `fixtures/src/data/provenance.test.ts` denylist). No real case, register record or personal data has been near the desk; the external register is never called (`w1-02-cases.test.ts` › `the external register is never called…`). D08 (retention and limits for real data) stays open.
- **One deployable on loopback.** The server binds `127.0.0.1` in every recorded run. No host, TLS, reverse proxy, backup or restore is claimed (W8, D10); helmet's CSP is present, HSTS is not (a host concern).
- **Performance targets are targets, not measurements.** Nothing here measures against `docs/engineering/performance-targets.md` beyond the graceful-shutdown drain budget the shutdown tests assert.
- **CI is the evidence of record for the repository; this record is one local run.** The same commands run in `.github/workflows/ci.yml` on every PR; the numbers above (347 unit, 135 integration, 108 evidence browser tests) are from this machine on 2026-09-22 against the checkout named in section 1.
- **Gate flips in this PR are documentation.** W2 issues become `status:ready` and M1 reads "Reached" because every automated clause has recorded output; the manual sign-in stays visibly pending in the same cells and is not marked recorded.

## 9. Gate changes, documents and checks after them

| Document | Change |
|---|---|
| `changes/2026-09-22-w1-exit/review.md` | this record |
| `TESTING.md` | new section "Google sign-in on loopback (manual, W1-08)": the runbook for Ta; a pointer to this record from the W1 evidence paragraph |
| `BUILD_PLAN.md` | status table cells only: W1 row → "Exit recorded 2026-09-22 (Google loopback sign-in pending Ta)"; M1 → "Reached"; W2 → "Ready" (rows for W1 and W2 added to the dated table; the package text above the table is unchanged) |
| `DEVLOG.md` | "Milestone M1: 2026-09-22" entry near the top: what exists and what is pending |
| `CHANGELOG.md` | one bullet under 2026-09-22 |

After the documents were written, from the repository root: `node scripts/check-links.mjs`, `node scripts/check-frozen-source.mjs`, `node --test scripts/*.test.mjs`, `node --test tests/*.test.mjs` and `git diff --check` were rerun; the results are in the PR body. Nothing under `rai-web/` changed, so the product suites in section 3 stand as run.

## 10. Tracker actions (this PR)

- Issues #31-#41 (W2 tickets): `status:blocked-by-gate` removed, `status:ready` added.
- Epic #53 (W2): comment "W1 exit recorded; W2 ready" with a link to this record.
- Epic #52 (W1): closed with a comment linking this record; the pending manual sign-in is named in the comment.
- Issue #30 (W1-08): closed by this PR (`Closes #30`).
- `POSTGRES_PORT=54330 docker compose -p rai-w1-08 down -v` after the PR opened.
