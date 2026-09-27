# Acceptance report: <run ID>

Template (W7-10). Filled after the run; see the [kit README](README.md). Source: [W7 plan](../../engineering/implementation-plan-w7.md) sections 1.2 (W7-D15, W7-D16, W7-D19) and 13; [BUILD_PLAN](../../../BUILD_PLAN.md) W7; [acceptance contract](../../acceptance.md).

> A synthetic dress rehearsal is **not PoC acceptance**. A developer or agent demonstration cannot substitute for operator acceptance (BUILD_PLAN W7). Synthetic data only for agent runs.

## 1. Run

| Field | Value |
|---|---|
| Run ID | |
| Kind | synthetic scripted / synthetic by hand / real (pending D08) |
| Commit | |
| Rehearsal plan | link to the filled [plan](rehearsal-plan-template.md) |
| Timing sheet | link to the filled [sheet](timing-sheet-template.md) |
| Deficiency log | link to the filled [log](deficiency-log-template.md) |

## 2. Synthetic pass criteria (W7-D15, provisional)

| Criterion | Met (yes/no) | Evidence |
|---|---|---|
| Every operator guide step completes unaided by code changes | | |
| No blocking deficiency (W7-D16) is open | | |
| The A01-A11 suites are green on the rehearsal commit (full plan section 10 gate, with counts) | | |
| Timings are recorded for every step (no target applies) | | |

Result: **pass / fail / pending** (an honest failed or pending rehearsal is a valid outcome).

## 3. Pending, not claimed

- The real rehearsal with operator Nakhun on 3-5 permitted cases (W7-D19): **pending D08 and the operator**.
- The operator's review of the W6 operator guide (BUILD_PLAN W7 entry): **pending the operator**.
- The operator-run rollback of one deployment by Nakhun: **pending the operator**.
- Rule outcomes: W4a/W4b stay provisional until D09; the W5 rubric is a synthetic placeholder until D07.
- Nothing was deployed; no non-loopback bind was performed (D10).

## 4. Proposed real PoC acceptance criteria

**Proposal by the agent team, for Ta and Nakhun to agree or replace at the D08-gated rehearsal. Not accepted; not in force.**

| # | Proposed criterion | Acceptance ID |
|---|---|---|
| P1 | The operator completes every permitted case's journey from the guide without developer help | |
| P2 | Every role sees and does only what it is authorized to, including by direct link | A01 |
| P3 | Send-back keeps the earlier version, its documents, findings and decisions readable and unchanged | A07 |
| P4 | Ready for launch appears only after three current-version approvals and every finding disposed | A09 |
| P5 | Notifications reach only the controlled recipients, and a failed delivery loses no review state | A05 |
| P6 | Reviewers record which QC findings they disagree with; the disagreement rate is reported, not gated | A08 |
| P7 | The full journey of each case can be rebuilt from the audit trail | A11 |
| P8 | No blocking deficiency (W7-D16) open; every non-blocking one triaged | |
| P9 | Step timings recorded; any time target is agreed at this rehearsal, not before | |

## 5. Remaining limitations

-

## 6. Decision

| Who | Role | Decision (accept / reject / pending) | Date |
|---|---|---|---|
| | Operator (Nakhun) | pending | |
| | Accountable owner (Ta) | pending | |
