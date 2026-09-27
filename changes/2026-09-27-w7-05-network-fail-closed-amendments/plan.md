# Plan: `network` fail-closed amendments and test seams (W7-05, #209)

Recorded before code. Files are the plan's W7-05 paths.

1. Board CLAIM on `docs/board/lane-a-workflow-server.md`; this frame.
2. **RED** (watch each fail):
   - `server/src/identity/config.test.ts`: ID-01 rows for `network` http (allow-list and ad) → `base_url_not_https`; https + `0.0.0.0` + `TRUST_PROXY=true` → ok.
   - `server/src/config.test.ts`: a `HOST=0.0.0.0` table over the four modes (pins the current code; expected green).
   - `server/src/start.test.ts` (new cases only; W4-13 cases untouched): `exchange` refused with `test_exchange_override_forbidden` outside `NODE_ENV=test` and off loopback, before parse (a config that would also fail parse still reports the seam reason); `exchange` accepted under `NODE_ENV=test` on loopback and actually reaches the adapter (a local-google sign-in through `/auth/callback` uses the injected claims); `discovery` refused under `NODE_ENV=production` with `test_discovery_override_forbidden`, but a parse failure under production still reports the parse reason; `network` + http through `startServer` exits 78 `base_url_not_https`, never listening.
   - `tests/integration/w1-01-startup-refusals.test.ts`: real process, `network` + http → 78 `base_url_not_https`, never listening.
3. **GREEN**: `identity/config.ts` S17 line in `case 'network'`; `start.ts` `exchange` override and the two guards.
4. W0-03 amendments (sections 3, 5 S17, 11 ID-01, 14) as dated notes.
5. Full gate from the task brief, one suite at a time; records (review.md, DEVLOG top entry, CHANGELOG line); commit; push; PR "Refs #209".

No migration, no `.env.example` change, no UI.
