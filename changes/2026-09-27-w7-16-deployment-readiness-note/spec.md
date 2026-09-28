# Spec: deployment-readiness note (W7-16, #234)

Source: [W7 plan](../../docs/engineering/implementation-plan-w7.md) section 9 row W7-16 ("Section 12 content; every key matches `config.ts`; no deploy performed") and section 12. The plan wins over issue #234.

1. **The note** `docs/engineering/deployment-readiness.md`, for one Node 24 process plus Postgres 16 on a generic host, with Replit as a worked example. It states that nothing is deployed and that the host, backup target, custody and incident channels are D10's. Sections, in the plan's order: build and start; configuration; database; blob storage; secrets; health; operations; known limits. Plus: what a host must provide (checklist), and the facts that are not yet on `main` (the `QC_MODE=content` keys of W4-13b and the W6-17 desk controls) marked as such, never described as available.
2. **Configuration table.** One row per environment key that non-test code under `rai-web/server/src` reads (`config.ts`, the identity slice it hands over, the secret source and the operator commands): key, who reads it, production value, source (literal, host, custody), note. The production values are the plan's: `NODE_ENV=production`, `HOST=0.0.0.0`, `TRUST_PROXY=true`, `RAI_IDENTITY_MODE=network`, `RAI_IDENTITY_NETWORK_SOURCE=allow-list`, `MAIL_MODE=sink-file`, `QC_MODE=deterministic` (until W4-13b), `LOG_PRETTY=false`, `RAI_PG_TOOLS=path`.
3. **Two further lists:** keys planned but not read by the code yet (`QC_MODEL`, `QC_EXTRACT_*`), and keys that exist only for local development and tests (never set on a host).
4. **Test** `rai-web/server/src/deployment-readiness.test.ts` (unit, no I/O beyond reading files):
   1. the table's keys equal the keys read by non-test code under `server/src` (scanned from `(env, 'KEY'` and `env.KEY` reads), both directions, naming each missing or stale key;
   2. no key in the planned list is read by the code yet (when W4-13b adds one, the note must move it into the table);
   3. every key of `rai-web/.env.example` is in the table or the local-only list;
   4. an environment built from the table's production values, with synthetic stand-ins for host and custody values, passes `parseConfig`, `parseIdentityConfig` (with the table's bind: `0.0.0.0`, https base URL, `trustProxy` true) and `parseBackupConfig`, and yields `nodeEnv` production, identity mode `network`, mail `sink-file`, QC `deterministic`, log pretty false;
   5. the note states that nothing is deployed and names D10 as the owner of host, backup target, custody and incident channels.
5. **Facts found while writing** that change what an operator must do are stated in the note and in review.md (for example: a workspace install keeps `@rai/fixtures` resolvable but unbuilt, so the release step must remove it before `npm start`).
6. **Records:** board CLAIM, this folder, DEVLOG top entry, CHANGELOG line under "## 2026-09-27". No migration; no product code; `check-links` green.
