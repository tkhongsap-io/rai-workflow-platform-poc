# Development log

## Tracker populated: 2026-09-21

GitHub issues opened for W0-W3: four epics and 45 ticket issues from the delivery pack, with labels, milestones and dependency links; W0 is Ready. See [docs/delivery](docs/delivery/README.md#tracker-of-record-d03-github-issues).

## G0 closed: 2026-09-21

Nakhun confirmed the review-desk scope, the operator role and the DPO SLA (D01). Ta recorded D02 (BRD), D05, D06, D11 and D12 with the brief defaults and authorized W0-W3 on synthetic data (D03). The [register](docs/product/decisions.md) is restructured into recorded and open tables; every document that marked those items pending now states the rule. D04 stays inside W0-01; D07-D10 stay open. Next: W0-01 stack ADR. Nothing is built. [Change record](changes/2026-09-21-g0-close/review.md).

## Delivery planning, second pass: 2026-09-21

Reviewed the delivery pack with a 34-agent workflow (five reviewers, one skeptic per finding, one synthesis): 24 findings confirmed, 4 refuted, 14 structural items applied from the s42-ci-platform comparison. Restructured slice 1 for parallel work: W1-00 substrate, Lane C substitutes and CI, Wx-INT integration tickets, `Done when` per ticket, merge order. Added W0-10 observability, audit and schema rules, UI quality bar and language rule, build principles, delivery risks, dated status, ADR template and index, build board lanes, architecture boundary map. Ta accepted D12 as a register row and A11 as an acceptance criterion on 2026-09-21; the D12 answer (which languages) stays open. D01-D11 unchanged. See the [change review](changes/2026-09-21-delivery-planning/review.md).

## Delivery planning: 2026-09-21

Added [docs/delivery](docs/delivery/README.md). It holds decision briefs for D01-D03, D05, D06 and D11, team roles and agent limits, the W0 technical contract with stack criteria but no selection, a W1-W3 ticket breakdown traced to A01-A09, a design-to-build map and a W4-W8 outline. Documentation only. G0 is still open and W0-W8 are not started. [Change review](changes/2026-09-21-delivery-planning/review.md) records the checks.

## README journey: 2026-09-21

Added the review journey, correction loop and completion gates to README. Demo behavior and unresolved production authority remain explicit. Documentation only; [change review](changes/2026-09-21-readme-user-journey/review.md) records verification.

## Video preview: 2026-09-21

Created a 30-second True RAI product-motion video from actual demo captures, inspired by an inspected Cursor launch video. MP4 decoding and QuickTime playback verified. Assets and renderer are in [media/demo-video](media/demo-video/README.md); [review](changes/2026-09-21-demo-video/review.md) records limits. Merged through PR #3 (`824eaa7`); not posted to social media.

## Current state: 2026-09-21

The local demo's revised functional gate passed: 22 unit/provenance tests and four UI-driven localhost suites. Fixed invalid Admin publication and a discard-control regression found during retesting. Original Claude export is immutable; intentional local corrections are declared in demo/reference/local-adaptations.json. Ta accepts small visual differences, so literal raster equality is no longer a blocker. See [functional gate](changes/2026-09-21-local-design-demo/functional-gate.md). Owner authorized commit, PR and merge after the functional gate passed. Production W0–W8 remain unstarted.

## Previous state: 2026-09-20

Product anchors: [PRD](PRD.md) and [BUILD_PLAN](BUILD_PLAN.md). Build packages W0-W8 are not started.

Documentation foundation and interactive Claude Design prototype prepared. Core synthetic owner/SPOC/reviewer/admin journey browser-tested; responsive/copy corrections completed and affected paths retested. See [handoff](docs/design/DEVELOPER_HANDOFF.md) and [test evidence](docs/design/TEST_RUNS.md). Application implementation has not started. No production services, dependencies, models, data stores or deployments exist. Prototype UI observations are not application runtime acceptance.

Owner: Ta. Proposed gate operator at the time: Nakhun (confirmed under D01 on 2026-09-21). Organization-level acceptance is not established by this repository.

### Next gates as recorded on 2026-09-20 (superseded by the G0 close above)

1. Operator confirmation and AI/COE document-mapping decision.
2. Explicit Ta start instruction, followed by a stack ADR and slice-1 implementation plan.
3. Implement and prove one synthetic case end to end, then add evaluated QC, risk proposal, admin controls and operator rehearsal.

That [change review](changes/2026-09-20-documentation-foundation/review.md) records documentation verification at the time.

## Next gates

1. W0-01 stack and deployment-boundary ADR (D04), then W0-02 file-level plan with paths, commands and CI checks, through W0 exit.
2. W1-00 substrate, then slice 1 (W1-W3) on synthetic data, authorized by D03: prove one synthetic case end to end.
3. D07-D10 before W4-W8: evaluated QC, risk proposal, admin controls, operator rehearsal and release remain gated.

The [G0 close record](changes/2026-09-21-g0-close/review.md) records the verification. The [decision register](docs/product/decisions.md) owns the open items.
