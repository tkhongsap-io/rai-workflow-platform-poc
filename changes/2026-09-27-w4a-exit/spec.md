# Specification

Source: W4a plan sections 8 and 10 (the plan wins over issue #190), with the plan-review notes on the ticket.

Done when:

1. **Clean checkout.** The evidence runs on `origin/main` `da3d815` in a new worktree with a fresh Postgres (`docker compose down -v` then `up -d --wait`), `rai-web/.env` from `.env.example` with only ports rewritten, and `npm ci`.
2. **Section 8 gate**, one suite at a time: lint, typecheck, unit, integration, build and `check:substitute-absent`, real-server browser, substitute browser, `check-links`, `git diff --check`. Each result is recorded with its exact summary line and counts.
3. **Section 10 exit evidence**, run separately:
   - the W4-03 and W4-04 fixture tests (`tests/integration/w4-03-deterministic-runner.test.ts`, `tests/integration/w4-04-upload-trigger.test.ts`);
   - the real-server test `tests/integration/w4a-int-deterministic-server.test.ts` with the plan section 8 command;
   - the W4-12 browser journeys on the real server;
   - readiness `qc.kind` = `deterministic` under `QC_MODE=deterministic`, read from the server started from source;
   - `check:substitute-absent`.
4. **Identity beside each output**: the `qc_rules` configuration revision ID and label `w4a.1`, the runner name and version, and the fixture set line `fixture set slice1-synthetic@1 <hash>`; for runs that bind the scripted substitute, that runner is named instead.
5. **Record** `review.md` in the style of the W3 exit review: the PR list with review rounds; deviations recorded by each ticket and deferred reviewer notes; known limitations (labels provisional until D09; no content rules, extraction or model, which are W4b; dedup deferred to W4b; the in-memory API substitute kept; upload runs evaluate 0 rules); what Ta reviews.
6. **Status text** (current status, not rewriting dated records): BUILD_PLAN new section "Status against this plan - 2026-09-27 (W4a engineering exit)"; the W4 work breakdown status line; the delivery README W4 line; the README status line; a board entry with the exit summary; DEVLOG and CHANGELOG.
7. No change to application code, tests, manifests or CI. Plan section 12 assigns no document amendment to this ticket.
