# Specification: owning lane for shared-slot, unreviewed-slot, pack-level and QC-unavailable findings

The rule, as Ta accepted it on 2026-09-25 (brief recommendations 1-5). The register row in `docs/product/decisions.md` is the record; this file restates it for the implementer.

| # | Finding on… | Rule | Mechanics |
|---|---|---|---|
| 1 | Slot 5 (BRD; all three lanes review it) | The lane whose QC rule raised it | The runner names `owningLane`; it must be one of the lanes that review slot 5 under the version's mapping, and on an `approve_attempt` run it must be the lane whose run it is. |
| 2 | Slot 9 (other supporting documents; no lane reviews it) | Informational only: QC raises no `defect` on slot 9 | A runner `defect` on slot 9 is a validation violation (`owning_lane_slot_informational`); the whole run is recorded `unavailable:runner_error`, as any invalid finding is (H7). Unsafe files are already refused at upload. |
| 3 | The whole pack (`scope.kind = 'pack'`) | AI/COE | `PACK_OWNING_LANE = 'ai_coe'`; a runner value that differs is `owning_lane_mismatch`. |
| 4 | QC unavailable (timeout, runner error, not configured, unreadable artifact) | Follow the run: `approve_attempt` → the lane whose run it is; `submit` → the pack owner (AI/COE); `upload` on a single-lane slot → that slot's lane | The orchestrator appends the W0-07 3.6 `QC-UNAVAILABLE` finding (`kind = 'unavailable'`, `slot = null`, severity `high`) once per open scope: if the latest `QC-UNAVAILABLE` finding for the same version, trigger and lane is still undispositioned, the new run reuses it and appends nothing. Slice 1 has no upload-triggered QC; the slot-5 and slot-9 upload sub-case is defined when upload QC arrives (W4). |
| 5 | The same finding again on N+1 | Never carried; re-dispositioned on each version | Already the behaviour (W0-06 4.6). Recorded; a test asserts a `QC-UNAVAILABLE` finding on N is not present on N+1. |

Done when:

1. **Register row.** `docs/product/decisions.md` carries one recorded row for the rule with approver, date, channel and affected documents, written by Ta (the agent drafts; Ta approves the wording before merge). The D05 row's affected documents mention it.
2. **Contract text.** W0-06 sections 7.1-7.4 state the recorded rule and no longer describe it as open; W0-07 3.5 (reserved rows), 3.6 (owning lane; the QC-unavailable finding) and 3.9 (script assertion row) match the code. No other document still says the rule is pending.
3. **Shared rule.** One function in `@rai/shared/constants` gives the owning-lane rule for a scope; `checkOwningLane` enforces it with the run's lane; `'refinement_pending'` and `owning_lane_rule_pending` no longer exist anywhere.
4. **QC-unavailable finding.** An `unavailable` run stores the finding of W0-07 3.6 with the rule's lane, deduplicated per open scope, returned in the run body, counted by Ready as undispositioned until the owning lane dispositions it, never auto-closed by a later completed run, and not carried to N+1.
5. **Fixtures.** The W1-10 substitute accepts slot-5 and pack-level `defect` findings with the recorded lane, refuses slot 9, run scope and `QC-UNAVAILABLE` at construction, and ships one slot-5 and one pack-level scripted finding on a fixture case no journey drives to Ready without dispositioning them.
6. **W2-05 done-when, every case.** A waiver by a non-owning lane is forbidden on a single-lane finding, a slot-5 finding and a pack-level finding; an `unavailable` result is recorded as a finding, not as zero findings; the other W2-05 cases stay green.
7. **Suites.** Unit, integration, both browser configurations, lint, typecheck, build, `check:substitute-absent` and the repository checks pass on a clean checkout. Browser specs that induce an unavailable run and then reach Ready are updated to disposition the finding first, or their expectation changes and says why.
8. **Records.** Board claim and entry on the Lane B stream; DEVLOG and CHANGELOG; the walkthrough script and the #35 brief note the outcome; `changes/2026-09-25-w2-05-owning-lane/review.md` lists commands, output and both reviewer verdicts. Issue #35 and epic #53 close when the PR merges.

Every PR: own worktree and Postgres port, full suite green, two independent reviewer agents posting verdicts on the PR, CI green on the reviewed head, base `main`. No migration: `qc_finding` already allows `kind = 'unavailable'` and `slot IS NULL`.

**Product consequence to be aware of (W0-07 3.6, not a new choice):** with no runner bound (`QC_MODE=none`), every submit and every approve attempt now yields a `QC-UNAVAILABLE` finding that its owning lane must disposition before the case can reach Ready. In fixture mode with the substitute bound this only happens on a simulated outage.
