# Review: W4a gate entry and W4-00a plan

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Docs only. Decisions recorded from Ta's answers in the Claude Code session of 2026-09-26: W4 shape (W4a first), slot-5/9 upload owner (a), substitute kept through W4a, the provisional W4a rule set.

The plan's facts about the current code came from a read-only survey of `rai-web/` on main at `32f8f4a`. Among other things it confirmed:
- `QC_MODE` accepts only `substitute`;
- `qc_rules` is never seeded;
- the upload hook is bound to a no-op and its promise is not drained;
- `qc_run` has no `runner_version` column;
- the finding read shapes carry no rule ID or evidence;
- the save rule stops a vendor case from keeping the non-vendor N/A default, which is why the vendor rule fires on any N/A.

## Commands and results

| Command | Result |
|---|---|
| `node scripts/check-links.mjs` | 0 broken |
| `git diff --check` | clean |

## Review verdicts

| Round | Head | Reviewer | Verdict | Acted on |
|---|---|---|---|---|
| 1 | f9271e3 | contract | BLOCK | B1 slot-5 dedup: dedup is dropped from W4a (completed runs replay), and a two-lane slot-5 test is required. B2 commands: plan section 8. N2-N9 folded in: the W0-07 section 6 amendment, the production refusal on either signal, the no-read and module-graph tests, team-and-roles "W4b–W8", stale status lines, no `info` severity, one revision ID, upload run `lane = NULL`. N1: the option Ta chose itself read "revisit at W4b kickoff", so the row is accurate (plan section 11 says so). N10: the branch name is kept for this docs PR; ticket branches follow the convention |
| 1 | f9271e3 | engineering | BLOCK | 1 dedup: dropped from W4a, deferred to W4b with the lane in the key. 2 revision identity: the configuration revision ID stays recorded; the body carries a `label`; the runner gets `request.rules` (a W0-07 3.3 amendment). 3 upload on a draft: submitted-still-open, carry-over gating Ready, the per-lane outage key, `runKey` as the in-flight key, and the substitute's upload scripts removed so CI suites don't change. Non-blocking notes folded in: `app.ts` wiring, `server/drizzle/`, the operator upload lookup, `ruleId` already present, "strictly before now", `lateQc` unchanged, the migration default dropped plus a CHECK, the readiness kind mapping, the test override only under `NODE_ENV=test` |
