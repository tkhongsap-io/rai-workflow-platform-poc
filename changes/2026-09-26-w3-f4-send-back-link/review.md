# Review: the owner's send-back mail opens the successor draft (W3-F4, #166)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Decision implemented: register row "W3 deferred rulings", item 12 (Ta, 2026-09-26). Synthetic data only.

## Change

- `server/src/notifications/compose.ts`: `caseLink(baseUrl, caseId)` (route `case`, `/cases/{caseId}`, sign-in required). A `sent_back` mail uses it. Lane-opened and Ready mail keep `versionLink`.
- `server/src/notifications/outbox.ts`: a `send_back` outbox row stores `casePath(caseId)` as `deep_link_path` at commit. The worker's existing agreement check (composed link path must equal the stored path, else `unsafe_link`) still applies.
- W0-07 section 4: the `deepLinks` comment says `sent_back` uses route `case`.
- The slice-1 table has a dated W3-F4 note, and #166 gets a correction.

## Deviation from the ticket wording

The W3-F4 row says the link "names the draft", and #166 says it is "built from the committed successor draft id". The SPA has no draft-specific URL: the case page is where the owner's open successor draft and its send-back feedback are shown (H27). So the link names the case, not the draft id. It opens the successor draft, as ruling 12 asks, and needs no new route. This is recorded as a dated note on the row.

## How the outbox change was found

The first GREEN (compose only) failed the w3-03a send-back test. The worker refused the mail as `unsafe_link` because the outbox row still stored the version path. So the stored path moved too, which keeps the committed-link check intact.

## Rows queued before this change

A `send_back` outbox row committed before this change stores the version path. On a retry, the worker's agreement check refuses it as `unsafe_link`, so it fails safe: nothing is delivered. No such row exists outside local synthetic databases, because nothing is deployed before D10.

## Commands and results

Worktree `/tmp/rai-names`, Postgres `rai-names` on 55372, one suite at a time.

| Command (from `rai-web/` unless noted) | Result |
|---|---|
| RED: `compose.test.ts` before the change | failed: `sent_back` link route was `case_version` |
| `npm run lint`, `npm run typecheck` | exit 0 |
| `npm run test:unit` | 590/590 |
| `npm run test:integration` | 334/334, 0 skipped. The w3-03a send-back test pins the delivered link path `/cases/{caseId}`, route `case`, the stored `deep_link_path`, and a signed-out 401 on the API path. |
| `npm run build && npm run check:substitute-absent` | 607 files, 0 markers |
| `npm run test:browser:server` | 196 passed (15.7m) |
| `npm run test:browser:substitute` | 48 passed |
| `node scripts/check-links.mjs` (root) | 0 broken |

## Review verdicts

| Round | Head | Reviewer | Verdict | Notes acted on |
|---|---|---|---|---|
| 1 | 1f8058a | contract | PASS | #166 correction posted; row note cites PR #178; older queued rows recorded above. Deferred: a browser assertion that the feedback heading shows on arrival from the mail link. |
| 1 | 1f8058a | correctness | PASS | older queued rows recorded above. Deferred: an `unsafe_link` test on a `send_back` row (same check as the lane-opened test). |
