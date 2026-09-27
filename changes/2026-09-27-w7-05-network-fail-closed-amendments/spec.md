# Spec: `network` fail-closed amendments and test seams (W7-05, #209)

Source: [W7 plan](../../docs/engineering/implementation-plan-w7.md) section 9 row W7-05, section 2 (`RAI_IDENTITY_MODE=network` row and the "New test seam (W7-05)" bullet), section 5.1 and section 14 risk 1. The plan wins over issue #209.

## Behaviour

1. **S17 extended to `network`.** `identity/config.ts` `parseIdentityConfig`, `case 'network'`: the first check is `bind.publicBaseUrl.protocol !== 'https:'` → refused `base_url_not_https`, for both sources (`allow-list` and `ad`), before any other `network` row. `adapter.start()` therefore refuses before discovery and the process exits 78 without listening. `TRUST_PROXY=true` stays allowed; `adapter.ts` `verifyBoundAddress` is unchanged (`network` may bind any address).
2. **ID-01 rows.** `network`/`allow-list` with `http://desk.example.test` → `base_url_not_https`; `network`/`ad` with an `http` base URL → `base_url_not_https`; `network`/`allow-list` with `HOST=0.0.0.0`, `TRUST_PROXY=true` and `https://desk.rai-desk.test` → ok. The existing "network/allow-list complete parses on any bind" row already uses an `https` base URL and is unchanged.
3. **`HOST` table (`config.test.ts`).** `parseConfig` accepts `HOST=0.0.0.0` for `network` and `production` and refuses it (`bind_not_loopback`) for `local-google` and `fixture`. Already the code; the test pins it.
4. **`StartOverrides.exchange`.** New optional `exchange?: Exchange` passed to `createIdentityAdapter`. `startServer` refuses it **before** `parseConfig` with `test_exchange_override_forbidden` (exit 78, one `process.refused` line) unless `NODE_ENV=test` and `HOST` is loopback. Any identity mode may use it in a test (W7-08 runs `network`).
5. **`discovery` override.** Refused only when the parsed `nodeEnv` is `production`, **after** `parseConfig` (so parse reasons keep precedence), with `test_discovery_override_forbidden`, before the database handle, fixtures import or adapter start. Outside production it is unchanged, so the W4-13 deterministic test (`local-google`/`development`) and the W4-13 substitute loop (`invalid:QC_MODE` under `network`/`development` and `local-google`/`production`) pass unchanged.
6. **Real process.** `node server/src/main.ts` with `RAI_IDENTITY_MODE=network`, source `allow-list`, synthetic OIDC values (issuer `https://idp.rai-desk.test`), `QC_MODE=deterministic` and `PUBLIC_BASE_URL=http://…` exits 78 with `base_url_not_https` and never listens (no discovery call is made).
7. **Start-up log** (`observability/started.ts`) unchanged: mode, loopback flag, commit only.

## Reason codes

`base_url_not_https` already exists in `StartupReasonCode`. The two new codes, `test_exchange_override_forbidden` and `test_discovery_override_forbidden`, are `process.refused` reasons written by `startServer` like `test_qc_override_forbidden`; they are not identity-adapter codes and never reach readiness.

## Spec amendments (W0-03, `docs/engineering/identity-adapter.md`, dated notes)

- Section 3: `network` is implemented in W7 with source `allow-list` only (W7-D3); `ad` parses (S9-S12) but is not rehearsed.
- Section 5 row S17: "`production` or `network`".
- Section 11 row ID-01: S17 names the `network` http rows and the https-accepted row; a note on the `exchange`/`discovery` seam guards.
- Section 14: the networked-rehearsal item ticked as answered by W7-D1 (walkthrough in `fixture` mode; `network` proven by W7-08) and W7-D3 (`allow-list` source, any configured OIDC issuer; synthetic `https://idp.rai-desk.test` in tests).
