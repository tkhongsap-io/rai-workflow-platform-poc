# Specification

Source: W4a plan section 2 (the plan wins over issue #187), plan section 8 (commands) and section 12 (amendments), with the plan-review notes on the ticket.

Done when:

1. **`config.ts`** `QC_MODE`: `deterministic` and `substitute` are the only values.
   - `deterministic` parses in every `NODE_ENV` and every identity mode.
   - `substitute` parses only when `NODE_ENV` is not `production` **and** `RAI_IDENTITY_MODE` is a local mode (`fixture`, `local-google`); otherwise `invalid:QC_MODE` (exit 78 through `start.ts`).
   - Unset or empty: `missing:QC_MODE`; any other value: `invalid:QC_MODE`, in every identity mode.
2. **`start.ts`**: `deterministic` binds `createDeterministicQcRunner` in every environment; `substitute` binds the W1-10 scripted runner loaded from `@rai/fixtures` (unbound, readiness `disabled`, when the fixtures package is absent). Neither ever falls back to the other. The production non-binding branch is removed (config refuses that case). The test override (`overrides.qcRunner`) keeps its guard unchanged (`NODE_ENV=test`, fixture identity, loopback host) and replaces whichever runner the mode selects.
3. **Readiness** `qc.kind`: from the bound runner's identity (`qcKindOf`, W4-11a); when no runner is bound, the configured `QC_MODE`. No hard-coded `substitute` in `start.ts`. The integration harness (`tests/support/fixture-app.ts`) reports the kind of the runner it injects the same way.
4. **Configuration files**: `.env.example` `QC_MODE=deterministic`. CI (`.github/workflows/ci.yml`) and the evidence harness keep `QC_MODE=substitute` explicitly: the evidence Playwright configuration starts the server through `tests/browser/support/real-server-lifecycle.ts`, which sets it, and `tests/support/process.ts` sets it for every spawned test server; the substitute Playwright configuration starts no product server and reads no `QC_MODE`.
5. **Tests**: unit refusals and acceptance per identity mode (`config.test.ts`); `startServer` binds `deterministic` outside test and reports it on readiness, refuses `substitute` under a non-local mode before listening, and reports the configured kind when the substitute cannot load (`start.test.ts`); the real process refuses `substitute` with `network` identity (`w1-01-startup-refusals.test.ts`); the real-server test keeps asserting readiness `qc.kind === 'deterministic'`.
6. `check:substitute-absent` passes.
7. **Docs**, dated amendments: W0-02 section 5 `QC_MODE` row (`implementation-plan-w1-w3.md`); W0-07 3.9 and section 6 (a real `QC_MODE` value arrives in W4a without ADR-0006, which stays W4b's; the production refusal); a W4a paragraph in `TESTING.md` (the real-server test command of plan section 8; `QC_MODE` pinning). The "until W4-13" comments are updated.
8. Full plan section 8 gate green.
