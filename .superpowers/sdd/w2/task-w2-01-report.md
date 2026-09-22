# W2-01 report — open three lanes on submit

**Status:** DONE  
**Commit:** `260c08779686cca08b66d2dccda3a112c08db804`  
**Branch:** `codex/w2-01-open-lanes` (from `main` at `fdd6a70`)  
**Issue:** #31  
**Date:** 2026-09-22

## What landed

Submit (`submitDraft`) now opens all three review lanes in the same transaction as the W1-05 freeze:

1. Existing freeze + `version.submitted` audit  
2. `lane.opened` × 3 for `ai_coe`, `dpo`, `it_security` (that order), `target_ref` holds lane, `slotsForLane` slots, mapping version, and the same idempotency key ref style as `version.submitted`  
3. Three `notification` rows: `event=lane_open`, single-role fixture recipients only, `status=queued`, `attempts=0`, `template_key=mail.lane_opened`, `deep_link_path=/cases/{caseId}/versions/{versionId}`, `template_params` = `{lane, version_id}`  

High risk does not skip any lane (`risk_tier` is never read for routing). SLA due dates are not stored. Mail is not sent. HTTP 201 body is unchanged (no lanes field).

Test-only deps field `failBeforeThirdLaneOpen` throws before the third `lane.opened`; unset in production wiring (`start.ts`).

## Files changed

| Path | Role |
|---|---|
| `rai-web/server/drizzle/0004_w2_01_notification.sql` | Forward-only migration: `notification` table, delivery-only UPDATE trigger, grants |
| `rai-web/server/drizzle/meta/_journal.json` | Journal entry for 0004 |
| `rai-web/server/drizzle/meta/0004_snapshot.json` | Drizzle snapshot |
| `rai-web/server/src/db/schema/notification.ts` | Drizzle schema |
| `rai-web/server/src/db/schema/index.ts` | Export |
| `rai-web/server/src/versions/open-lanes.ts` | Lane open + notification inserts (`slotsForLane`, recipients) |
| `rai-web/server/src/versions/service.ts` | Extend submit transaction; optional failure injection |
| `rai-web/tests/integration/w2-01-lanes.test.ts` | Done-when coverage |
| `rai-web/tests/integration/w1-05-submit.test.ts` | Expect 3× `lane.opened`; ignore them in version-read audit filter |
| `rai-web/tests/integration/w1-00-migrations.test.ts` | Table / trigger / grant expectations for `notification` |
| `rai-web/tests/support/db.ts` | Truncate `notification` in `BUSINESS_TABLES` |
| `docs/board/lane-a-workflow-server.md` | CLAIM + landed note (append-only) |
| `DEVLOG.md` | W2-01 note: lane open on submit is not the W2 exit |

## Tests

Postgres: `POSTGRES_PORT=54351 docker compose -p rai-w2-01` (real roles from `docker/postgres/init`).  
`npm run migrate` → `migrate: applied 5 migration(s), 0 already applied`.

### Command

```sh
cd rai-web
NODE_ENV=test RAI_IDENTITY_MODE=fixture node --import tsx --conditions=rai-source --test --test-concurrency=1 \
  tests/integration/w2-01-lanes.test.ts \
  tests/integration/w1-05-submit.test.ts
```

(Also verified `tests/integration/w1-00-migrations.test.ts` earlier in the same session: 3/3 pass, including the new `notification` table/trigger/grants.)

### Output summary (exact run that passed)

```
ℹ tests 22
ℹ suites 7
ℹ pass 22
ℹ fail 0
ℹ duration_ms 10872.769709
```

- W1-05: 18 pass  
- W2-01: 4 pass (three lanes + notifications; injected third-lane failure rolls back; high risk still three lanes; Idempotency-Key replay adds no rows)

## Concerns

1. **Local `.env`:** Created from `.env.example` with port `54351` for this ticket’s Postgres; file is gitignored and was not committed.  
2. **Injected failure HTTP shape:** Failure surfaces as a 5xx from Fastify (plain `Error`), not a W0-06 contract code — acceptable for the test-only hook; production never sets it.  
3. **Out of scope (intentional):** approve/send-back, Ready, UI, QC, mail delivery, SLA clock columns, GitHub issue close, push/PR.

## Fix round 1

**Status:** DONE  
**Commit:** `6a5a08e25f72ca7508766aa15e06e857e21be023` (new commit; did not amend `260c087`)

Addressed independent-review findings on `codex/w2-01-open-lanes`.

### Changes

- Recipients from fixture identities that hold each lane (`laneOpenRecipientsFromIdentities`); dual-role DPO included → 4 notification rows (2 DPO). No hardcoded emails in `open-lanes.ts`.
- Failure injection fires after the first notification insert; gated on `NODE_ENV === 'test'`.
- Slots resolved via `LANE_MAPPINGS_BY_VERSION[version.laneMappingVersion]`.
- `mail.lane_opened` in th/en catalogues; template key typed as `LocaleKey`.
- Notification immutability + unique-index behavioural tests; `notification` added to rai_app DELETE loop in `w1-00-audit.test.ts`.
- Board correction entry; Evidence → PR #90.
- Prettier/lint clean.

### Commands

```sh
cd rai-web
npm run lint
# → pass (eslint + prettier --check + check-css)

NODE_ENV=test RAI_IDENTITY_MODE=fixture node --import tsx --conditions=rai-source --test --test-concurrency=1 \
  tests/integration/w2-01-lanes.test.ts \
  tests/integration/w2-01-notification.test.ts \
  tests/integration/w1-05-submit.test.ts \
  tests/integration/w1-00-audit.test.ts \
  tests/integration/w1-00-migrations.test.ts
```

### Output summary

```
ℹ tests 33
ℹ suites 7
ℹ pass 33
ℹ fail 0
ℹ duration_ms 16136.640417
```

Also: `shared/src/locales/locales.test.ts` → 3/3 pass.

## Fix round 2

**Status:** DONE  
**Commit:** `e0da08fbb14f81b9c072a083b87829bdda83f70f`

Threaded `config.nodeEnv` into `VersionServiceDeps` via `buildApp` (injected at route registration). `open-lanes.ts` no longer reads `process.env`; the test-only failure guard uses the passed `nodeEnv`.

### Commands

```sh
cd rai-web
npm run lint
# → pass

NODE_ENV=test RAI_IDENTITY_MODE=fixture node --import tsx --conditions=rai-source --test --test-concurrency=1 \
  tests/integration/w2-01-lanes.test.ts \
  tests/integration/w2-01-notification.test.ts
```

### Output summary

```
ℹ tests 8
ℹ suites 1
ℹ pass 8
ℹ fail 0
ℹ duration_ms 4236.250458
```
