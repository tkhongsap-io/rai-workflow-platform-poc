# Deficiency log: <run ID>

Template (W7-10). Filled during and after the run; see the [kit README](README.md). Source: [W7 plan](../../engineering/implementation-plan-w7.md) section 1.2 (W7-D16) and section 9 rows W7-14 and W7-15.n; [BUILD_PLAN](../../../BUILD_PLAN.md) W7 ("capture unaided workflow completion, deficiencies, findings reviewers disagree with, manual workarounds and timings").

> Synthetic data only for agent runs. For a real run, describe a deficiency without case contents; a real rehearsal's contents never enter Git.

## Blocking rule (W7-D16, provisional)

A deficiency is **blocking** when any of these holds:

1. a submitted version, its artifact bytes or its audit trail is lost or altered;
2. authorization is wrong (a role sees or does what it should not, or cannot do what it should);
3. readiness or Ready-for-launch gating is wrong;
4. a step of the operator guide is impossible to complete;
5. a start-up fails open;
6. data outside the synthetic set appears.

Everything else is **non-blocking**: logged here and triaged. Each blocking deficiency gets a W7-15.n issue and a fix PR with a failing test first; the synthetic rehearsal cannot exit while one is open.

## Deficiencies

Kinds: `defect` (the desk behaves wrongly), `guide` (the operator guide is wrong or silent), `disagreed-finding` (a reviewer disagrees with a QC finding), `workaround` (a step completed only by a manual workaround), `other`.

| ID | Step ID | Kind | Severity | Description | Evidence | Issue | Status |
|---|---|---|---|---|---|---|---|
| D-01 | | | blocking / non-blocking | | log line, screenshot path or test name (no real case content) | W7-15.n / #N / none | open / fixed in #N / accepted limit |

## Unaided completion

| Guide section | Completed unaided (yes/no) | Deficiency IDs |
|---|---|---|
| | | |

## Triage notes

| Date | Who | Decision |
|---|---|---|
| | | |
