# Delivery pack

Status: **G0 closed 2026-09-21. W0-W3 authorized on synthetic data (D03). W0 tickets are Ready; W1-W3 tickets are blocked by W0 exit.** [BUILD_PLAN](../../BUILD_PLAN.md) stays the canonical plan. This pack is the work a team of 2-3 engineers plus AI agents picks up now.

## Read in this order

1. [Decision briefs](g0-decision-briefs.md): the reasoning behind the recorded decisions and the open ones; the [register](../product/decisions.md) holds the answers.
2. [Team and roles](team-and-roles.md): who owns what, a RACI per package, and what agents may and may not do.
3. [W0 technical contract](w0-technical-contract.md): stack ADR criteria, the interface specs, audit, schema evolution, observability, UI quality bar and language rules. This is where the frontend and backend engineering documents get written.
4. [Slice 1 work breakdown](slice-1-work-breakdown.md): W1-W3 tickets with acceptance IDs, dependencies and owner types.
5. [Design-to-build map](design-to-build-map.md): each designed screen to its tickets and server invariants; what in the demo is simulation only.
6. [Agent task brief template](agent-task-brief-template.md): how to hand one ticket to an agent.
7. [Later packages](later-packages-outline.md): W4-W8 outline and candidate backlog.

## Path at a glance

```
G0  decisions D01-D03 ............ Ta, Nakhun             (closed 2026-09-21)
W0  technical contract ........... tech lead + Ta          (10 tickets, docs + ADR) ← START HERE
W1  case + versioned pack ........ Lanes A / B / C         (15 tickets incl. Lane C and W1-INT)
W2  lanes, send-back, Ready ...... D02, D05 recorded       (11 tickets)
W3  queue, mail sink, SLA ........ D06, D11 recorded       (9 tickets) → slice 1 done
W4-W8 ............................ outline only; not authorized
```

## Ticket status legend

| Status | Meaning |
|---|---|
| Blocked by gate | An entry package is not met. W1-W3 tickets start here until W0 exit. |
| Ready | Entry met; can be assigned. All W0 tickets are Ready. |
| In progress | Assigned, branch open |
| Evidence recorded | Tests and outputs recorded in the package's `changes/` review. Only this status closes a ticket. |

Per package: contract PR → lane PRs in parallel → Wx-INT → exit evidence. The per-package `changes/` record follows BUILD_PLAN "Definition of done".

Live ownership and progress go in the append-only [build board](../board/README.md), one stream per lane. These documents define the work; the board records who holds it.

## Tracker of record (D03): GitHub issues

Opened 2026-09-21 on Ta's instruction: one epic per package and one issue per ticket, labelled by package, lane, owner type and status, with milestones W0 exit, M1, M2, M3. If an issue and these documents disagree, the document wins and the issue is corrected.

| Epic | Issue |
|---|---|
| W0 technical contract | [#51](https://github.com/tkhongsap-io/rai-workflow-platform-poc/issues/51) (10 tickets, Ready) |
| W1 scoped case and versioned pack | [#52](https://github.com/tkhongsap-io/rai-workflow-platform-poc/issues/52) (15 tickets, blocked by W0 exit) |
| W2 parallel reviews, send-back, Ready | [#53](https://github.com/tkhongsap-io/rai-workflow-platform-poc/issues/53) (11 tickets) |
| W3 queue, notifications, SLA | [#54](https://github.com/tkhongsap-io/rai-workflow-platform-poc/issues/54) (9 tickets) |

Filter: `label:package:W0 label:status:ready` shows what can start now. W4-W8 have no issues; they are not authorized.
