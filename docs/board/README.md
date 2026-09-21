# Build board

Append-only narrative log, one Markdown stream per lane, so people and agent sessions can see who holds a lane, what landed, and what is next. It records ownership and evidence; it is not the tracker of record for ticket status, and it never records a decision D01-D12 as made (the [register](../product/decisions.md) does that).

Adapted from the s42-ci-platform board convention.

## Streams

| Stream | Covers |
|---|---|
| [lane-lead-integration.md](lane-lead-integration.md) | W0, W1-08, W2-08, W3-06, Wx-INT reviews |
| [lane-a-workflow-server.md](lane-a-workflow-server.md) | Lane A tickets |
| [lane-b-ui-notifications.md](lane-b-ui-notifications.md) | Lane B tickets |
| [lane-c-platform-substitutes.md](lane-c-platform-substitutes.md) | Lane C tickets |
| [lane-decisions-and-docs.md](lane-decisions-and-docs.md) | D-item evidence, PRD and plan edits |

## Entry template

```text
## YYYY-MM-DD HH:MM — <headline>
- What: <what landed or was decided>
- Why: <reason>
- Next: <the next concrete step, and whose it is>
- Author: operator=<person> session=<session-or-run-id> model=<model-id>
- Evidence: <PR, commit, or changes/ file link>
```

## Claim rule

Before working a lane, append a claim to its stream:

```text
## YYYY-MM-DD HH:MM — CLAIM <lane>
- Author: operator=<person> session=<session-or-run-id> model=<model-id>
- Takes over from: session=<previous-session-id or none> (reason: new | crash | handoff)
```

One pen-holder per lane at a time. Every new session reads this README and all streams before starting, then either takes free work or writes an explicit `Takes over from` claim. Streams are append-only: record corrections as new entries; never edit or delete prior entries.

## Write path

The board entry rides the same branch and PR as the work it describes, with that PR as Evidence. A docs-only entry may go directly where repository rules allow. Frequent standalone board PRs mean the default path is not being followed.
