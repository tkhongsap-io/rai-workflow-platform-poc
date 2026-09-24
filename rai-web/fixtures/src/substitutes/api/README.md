# In-memory API substitute (W1-13, extended by W2-10)

Dev/test-only stand-in for the W1/W2 server: it answers every request/response shape of the [W0-02 plan section 7](../../../../../docs/engineering/implementation-plan-w1-w3.md#7-w1-interface-shapes) (7.2–7.6 from W1-13; 7.7 lane decision, send-back, lane QC and disposition from W2-10) from the W1-09 fixture set (`fixture set slice1-synthetic@1`), with the [W0-06 8.2](../../../../../docs/engineering/workflow-transition-and-error-contract.md#82-response-envelope) error envelope for every 401, 403, 404, 409 and 422 the section names. Lane B (W1-06, W1-07, W2-07, W2-09) builds against it; W3-08 extends it further. **This is not the W2 exit.**

**Never deployed, never evidence.** Every module here references `SUBSTITUTE_MARKER` (`../../substitute-marker.ts`); `npm run check:substitute-absent` fails if the marker reaches `web/dist` or `server/dist`, application configuration has no API-substitute selector, `startApiSubstitute()` refuses any `NODE_ENV` but `test` or `development` and any bind that is not loopback, and no file under `server/src` or `web/src` imports it (`absence.test.ts`). A Lane B ticket's Proves IDs are realised only when Wx-INT runs the same spec against the real server ([section 8.1](../../../../../docs/engineering/implementation-plan-w1-w3.md#81-layers)).

**Never a client-side permission rule.** The substitute is the stand-in _server_: it calls W1-01's `authorizeRequest`, which calls the W1-00 policy rows and `authorize` from `server/src/authz/`, so a request the W0-05 matrix denies gets the same 403 (and the same 404 for an `all_cases` holder on an unresolvable id) as from the real server, and the substitute never adds a row of its own ([W0-05 section 6, "Substitute (W1-13)"](../../../../../docs/engineering/authorization-policy-matrix.md#substitute-w1-13)). The SPA only ever sees the responses.

## Use

```sh
# a Node test or a Lane B unit test, in-process, no socket
import { createApiSubstitute, createSubstituteFetch } from '@rai/fixtures/substitutes/api/index';
const substitute = createApiSubstitute();          // fixture state; substitute.reset() rebuilds it
const fetch = createSubstituteFetch(substitute);   // fetch-shaped, keeps the session cookie between calls

# a Playwright config (webServer) or a development session, on loopback
import { startApiSubstitute } from '@rai/fixtures/substitutes/api/index';
const running = await startApiSubstitute({ port: 8787 });   // { baseUrl, close() }; NODE_ENV must be test|development

# Historical Lane B browser rehearsal only, from rai-web/ (not application config):
SUBSTITUTE_PORT=8789 SUBSTITUTE_WEB_PORT=5175 npm run test:browser:substitute
# The harness owns the proxy and warning; NODE_ENV=test, loopback only, no build mode.
```

Sign in with `POST /auth/fixture/sign-in { fixtureUserId }` (the eight identities of `data/users.ts`); the session cookie is `rai_session`. `X-Correlation-Id` is minted per request; every answer carries `Cache-Control: no-store` and `X-RAI-Substitute: <marker>` so a response from the substitute can never be mistaken for one from the server.

## What it holds

Built by `store.ts` exactly as `fixtures:load` would put it in Postgres: the five W0-08 8.3 cases in `draft` with `caseRevision 1`, one open draft each with the nine slot dispositions, the 33 artifact rows (bytes generated on first download by the W1-09 generator, hashes from `data/manifest.json`), the W1-00 configuration seed as `ConfigurationView`, no submitted version, no decision, no finding (W0-08 8.1 rule 4). Sessions, uploads, versions, lane decisions, QC runs, findings, dispositions and idempotency records are added at run time and lost when the process ends; `reset()` returns to the fixture state. Lane QC uses the colocated W1-10 `ScriptedQcRunner` (scripted single-lane findings only; slot 5 / pack / unavailable findings are never stored). Ready is set only inside approve or disposition when three current-version approvals exist and no finding is undispositioned — there is no POST `/ready`.

## Order of checks and what is reproduced

Every request runs the [W0-06 section 4](../../../../../docs/engineering/workflow-transition-and-error-contract.md#4-events) order: session (401) → authorization (403, through `authorizeRequest`, including `target:lane` for decide/qc-run) → existence (404) → validation (422, TypeBox schemas from `@rai/shared/schemas`, field paths and locale keys as the server's error handler maps them, the W0-05 section 5 projected-field rule) → idempotency (W0-06 5.3: replay of the same actor, key and body returns the stored response; another body under the same key is 422 `idempotency_key_reused`) → expected version (409 `revision_changed` / `version_superseded` / `version_closed` / `lane_already_decided` with `current` and `refreshPath`) → apply.

Uploads run W0-08 section 4 checks 1-8 and 10 (session, scope, open draft, filename rule incl. the non-empty stem and the 200-code-point limit, per-file limit, empty file, magic sniff, sniffed kind versus extension, per-pack total) with the section 5 reason keys. The structural checks of W0-08 2.1, 2.2 and the PNG/JPEG rules (check 9) are the product sniffer's (W1-03, `server/src/artifacts/`) and are **not** reproduced: a file the substitute accepts may still be refused by the server.

## Known drift from the server (rehearsal only, never evidence)

- Approve checks only that `qcRunId` is a well-formed UUID. The server also refuses an approve when the version and lane have no lane-QC run (422 `lane_qc_not_run`) or when a newer run exists (409 `qc_run_superseded`). The substitute does neither.
- Version reads always carry `decisions: []`. The server serves the version's lane decisions there, send-back feedback included (W0-02 7.6).
- The substitute keeps its own UUID check (`requireQcRunId` in `workflow.ts`) and its own undispositioned-finding predicate for Ready (`applyReadyIfHeld`). Neither is the server's code.

Deleting the substitute is Ta's decision and is on the W3 hardening deferred list. Until then this drift is documented here and is not fixed.

## Files

| File                                                                                               | Holds                                                                                                        |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `handler.ts`                                                                                       | `createApiSubstitute()`: the route table and the per-request pipeline                                        |
| `routes-auth.ts`, `routes-cases.ts`, `routes-artifacts.ts`, `routes-pack.ts`, `routes-versions.ts` | one file per section-7 subsection (7.2–7.6)                                                                  |
| `routes-review.ts`                                                                                 | W2-10: approve, send-back, lane qc-run, disposition (7.7)                                                    |
| `workflow.ts`                                                                                      | CaseView/CaseSummary projections, stale envelope, idempotency, draft defaults, Ready helper, successor draft |
| `store.ts`                                                                                         | the in-memory state built from the fixture tables plus W2 decisions/findings/dispositions                    |
| `support.ts`, `multipart.ts`, `sniff.ts`                                                           | envelope and validation helpers, the multipart reader, the sniff approximation                               |
| `server.ts`, `serve.ts`, `fetch.ts`                                                                | the loopback node:http server, its CLI, the in-process fetch adapter                                         |
| `contract-cast.ts`                                                                                 | boundary casts for three contract fields whose TypeBox `Static` type infers as `never` today (see the file)  |
| `testing.ts`                                                                                       | `call`, `signIn`, `multipartFile` for in-process tests                                                       |
| `*.test.ts`                                                                                        | one suite per subsection plus the server and the absence proof; part of `npm run test:unit`                  |
