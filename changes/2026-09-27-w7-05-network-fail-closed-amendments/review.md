# Review: `network` fail-closed amendments and test seams (W7-05, #209)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Source: [W7 plan](../../docs/engineering/implementation-plan-w7.md) section 9 row W7-05, section 2 (`RAI_IDENTITY_MODE=network` row, "New test seam (W7-05)"), section 5.1 and section 14 risk 1 (the plan wins over issue #209). Decisions implemented: register rows "Ta's delegation (2026-09-27)" and "W7 delegated rulings (provisional)" (W7-D1, W7-D3). D07-D10 untouched. Synthetic data only; nothing deployed.

## Change

- **`server/src/identity/config.ts`**: `parseIdentityConfig`, `case 'network'`: first line refuses `base_url_not_https` when `bind.publicBaseUrl.protocol !== 'https:'`, for both sources and before S6. `adapter.start()` therefore refuses before discovery. `verifyBoundAddress`, `TRUST_PROXY` handling and `parseQcMode` unchanged.
- **`server/src/start.ts`**: `StartOverrides.exchange?: Exchange`, passed to `createIdentityAdapter`. Refused **before** `parseConfig` with `test_exchange_override_forbidden` unless `NODE_ENV=test` and `HOST` is loopback (any identity mode). The `discovery` override is refused **after** `parseConfig` when `config.nodeEnv === 'production'` (`test_discovery_override_forbidden`), before the web-bundle check, the fixtures import, the database handle and the adapter.
- **Tests**:
  - `identity/config.test.ts` (ID-01): +5 rows: `network`/`allow-list` http (networked bind and loopback bind), `network`/`ad` http, http before the S6 source row → `base_url_not_https`; `network`/`allow-list` with `https://desk.rai-desk.test`, issuer `https://idp.rai-desk.test`, `HOST=0.0.0.0`, `TRUST_PROXY=true` → ok. Existing rows unchanged (the `network` rows already used an `https` base URL).
  - `config.test.ts`: the `HOST=0.0.0.0` table (accepted for `network`/development, `network`/production, `production`; `bind_not_loopback` for `local-google` and `fixture`). Pins current code; green before and after.
  - `start.test.ts`: new cases only. Six `exchange` refusals (development, production, `HOST=0.0.0.0` under test for `local-google` and `network`, an unknown mode under production, an empty `HOST`), each asserting the seam reason (so the guard precedes parse) and that nothing listens; the accepted case under test on loopback drives `/auth/sign-in` → `/auth/callback` and asserts the injected exchange answered with the transaction's state; `discovery` under production refused, the injected discovery never called, nothing listens; parse reasons under production keep precedence over the discovery guard (`mode_unknown`, `invalid:QC_MODE`, `log_pretty_in_production`); `network` + http through `startServer` → `base_url_not_https`, discovery never called, nothing listens. The W4-13 cases are **unchanged** and green.
  - `tests/integration/w1-01-startup-refusals.test.ts`: the real process with a synthetic `network`/`allow-list` configuration, `HOST=0.0.0.0`, `TRUST_PROXY=true` and an http base URL exits 78 `base_url_not_https`, never listening, no `process.started`.
- **W0-03 (`docs/engineering/identity-adapter.md`)**, dated W7-05 notes: section 3 (`network` implemented with `allow-list` only in W7; `ad` parses but is not rehearsed; https required); section 5 row S17 ("`production` or `network`"); section 6.3 cookie note; section 11 ID-01 row and a seam-guard note; section 14 networked-rehearsal item ticked as answered by W7-D1 and W7-D3.
- Records: board CLAIM (`docs/board/lane-a-workflow-server.md`), DEVLOG top entry, CHANGELOG line.

## Deviations

- **Exchange guard covers every identity mode.** The plan says "like `qcRunner`", whose guard also requires `RAI_IDENTITY_MODE=fixture`. W7-08 must use `exchange` under `network`, so the exchange guard checks only `NODE_ENV=test` and a loopback `HOST`, as the plan's own wording of the seam states.
- **Discovery guard placed before the web-bundle check.** "After `parseConfig`" is kept; it runs immediately after it, so under production the seam reason is reported before `missing:web/dist` and before any fixtures import or database handle. Parse reasons keep precedence, as the plan requires.
- **Extra ID-01 rows.** Beyond the plan's two `network` rows, the `ad` source and the "http before S6" ordering are pinned, since S17 is placed first in `case 'network'` for both sources.
- **Accepted-exchange test points discovery's `token_endpoint` at `https://127.0.0.1:1/token`**, so a regression that ignored the override would fail locally instead of calling a provider.
- **RED-phase network note.** During the RED run, before the seam and the S17 line existed: (a) the accepted-exchange case still used the file-level synthetic Google discovery, so openid-client's real code exchange may have attempted `https://oauth2.googleapis.com/token` once with a synthetic code and synthetic client values (the case then failed); (b) the real-process integration case reached discovery for the reserved `.test` issuer `https://idp.rai-desk.test`, which cannot resolve, and answered `discovery_failed`. No real credential or data was involved. After GREEN neither path is reachable (the exchange override is honoured and the token endpoint is a closed loopback port; S17 refuses before discovery). Recorded for the reviewer against the "no external network calls from tests" limit.
- **Formatting.** Prettier ran only on the two edited test files (`start.test.ts`, `w1-01-startup-refusals.test.ts`); the diff shows it touched only the added lines. No formatter on board, DEVLOG, CHANGELOG or review tables.

## Commands and results

Worktree `/tmp/rai-w7-05-network-fail-closed-amendments` from `origin/main` `1216750`, Postgres project `rai-ops` on 55385 (fresh, `down -v` then `up -d --wait`), `rai-web/.env` from `.env.example` with 54320 → 55385, `PORT=8841`, `PUBLIC_BASE_URL=http://127.0.0.1:8841`, `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8842`, `SUBSTITUTE_PORT=8843`, `SUBSTITUTE_WEB_PORT=5195`, `OBS_MIGRATION_ADMIN_URL` for 55385, `RAI_PG_TOOLS=docker-compose:rai-ops`. One suite at a time after `set -a; . ./.env; set +a`; logs under `/tmp/rai-w7-05-network-fail-closed-amendments-logs/`.

| Command (from `rai-web/` unless noted) | Result |
|---|---|
| RED: `NODE_ENV=test RAI_IDENTITY_MODE=fixture node --import tsx --conditions=rai-source --test server/src/identity/config.test.ts server/src/config.test.ts server/src/start.test.ts` | 4 ID-01 `network` http rows failing (`ok` instead of `base_url_not_https`); 6 exchange-guard cases, the accepted-exchange case, the discovery-guard case and the `network` http case failing; HOST table, https row and parse-precedence case passing (they pin existing behaviour). The run then hung on the servers the unguarded overrides started and was stopped |
| RED: `node --import tsx --conditions=rai-source --test --test-name-pattern W7-05 tests/integration/w1-01-startup-refusals.test.ts` (identity/config.ts at `HEAD`) | 1 failing: `discovery_failed` instead of `base_url_not_https` |
| GREEN: the three unit files | 97/97 |
| `npm ci` | exit 0 |
| `npm run lint` | exit 0 (first run: Prettier on the two new test blocks, fixed with `prettier --write` on those two files) |
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | exit 0, 821/821, 0 skipped |
| `npm run test:integration` | exit 0, 391/391, 0 skipped |
| `npm run build && npm run check:substitute-absent` | exit 0; `scanned 727 files, 0 with the marker` |
| `npm run test:browser:server` | exit 0, 205 passed (8.4 min) |
| `npm run test:browser:substitute` | exit 0, 48 passed (33.8 s) |
| `node scripts/check-links.mjs` (repo root) | exit 0; 403 Markdown files, 1159 relative links, 0 broken (the first run, before this file existed, reported the DEVLOG link to it) |
| `git diff --check` (repo root) | exit 0 |

## Reviewer checklist

- S17 in `network` refuses before discovery and before listening (unit, `startServer`, real process).
- `exchange` override: refused before parse unless `NODE_ENV=test` and loopback `HOST`; accepted path proven to reach the callback.
- `discovery` override: refused only under production, after parse; the W4-13 `start.test.ts` cases pass unchanged.
- No migration, no `.env.example` change, no UI, no change to `observability/started.ts`.
