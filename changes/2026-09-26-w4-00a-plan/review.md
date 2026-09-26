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

Recorded on the PR.
