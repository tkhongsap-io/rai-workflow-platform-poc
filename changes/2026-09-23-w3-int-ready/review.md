# Ready repair: local verification and review handoff

Base: `a055ccd8df6cd77ffea57d6a75d8ed6fe71884b8`; isolated branch `codex/w3-int-ready`. Plan preceded code; parent approved exactly five code/test paths plus this packet. No server, locale, client, schema, shared helper, root-log or parent journey changes. Local commit only; publication and assembly remain parent-owned.

## Implemented behavior

Explicit server `aiReadinessStatus=ready` selects persisted GET-only findings. Reviewer panels retain their own lane, consistent with their heading and pre-Ready presentation; owner/SPOC retains the authorized full list. Recorded dispositions remain visible without mutation controls. Decision/disposition guards deny actions even under a contradictory pending lane projection. The load-mode key invalidates stale workspace results. A ready=true disposition refreshes case/version state through the same reload token used after decisions; loading removes the old action workspace. Ready omits only action-inviting intro copy. ErrorNotice, authentication handling and server refusal are unchanged; no blanket suppression.

## Independently executed local author checks

Node24.21.0, own npm dependencies installed; application and fixture builds completed. Dedicated loopback service verified as running `rai-w3-int-observability-postgres-1`, project `rai-w3-int-observability`, bound to127.0.0.1:54371; browser58859 was free before use. Ignored local config selects that service for all three roles. Existing helper validates all DB URLs and creates/drops only a generated database for each new scenario. Affected W2 tests reset only the assigned base fixture database while their managed child is stopped.

- Old application at the base: **2 expected regression failures** at desktop1440. Final approval returned201/ready=true and rendered Ready, then failed because one error alert remained. Final disposition returned201/ready=true but failed because the Ready status never rendered. Initial command setup attempts selected a nonexistent project name and lacked built exports; neither executed a test and neither is claimed as regression evidence. The recorded red run followed a successful old-source build.
- Final `npm run test:unit`: **538 passed, 0 failed/cancelled/skipped**. Focused view-model file:14 tests, including two new guard/load-mode tests.
- Final `npm run typecheck` and `npm run lint`: pass. Early author iteration fixed a unit annotation and typed SQL result arrays; final evidence is the corrected source below.
- Final real browser command: `NODE_ENV=test RAI_IDENTITY_MODE=fixture PLAYWRIGHT_BASE_URL=http://127.0.0.1:58859 npx playwright test -c tests/browser/playwright.config.ts w3-int-ready-readonly w2-int-07-reviewer-workspace w2-int-09-disposition`: **18 passed, 0 skipped**,48.6s. Six new Ready scenarios plus12 affected W2 regressions across1440/834/390. A preliminary repaired six-case run also passed; final18 is the delivery evidence.
- Keyboard final actions use Tab/Enter and visible focus. Actual HTTP establishes prerequisites, actual startup uses the committed test-only scripted QC runner; no intercepted/fabricated API responses or SQL business-state writes. Submit QC is observed committed before lane setup.
- Both final approval and final disposition return201/ready=true, yield authoritative Ready, and then use a findings GET without unsolicited page mutation POSTs, stale alerts or action controls. Direct navigation and reload cover IT (empty own lane), AI/COE (persisted fixed finding), and owner (persisted fixed finding). SQL rows for QC runs, findings, dispositions and version audit evidence remain identical while these users view/reload. Explicit real QC/disposition probes still return409; a different owner receives the visible real403.
- Targeted axe checks pass for each Ready role/width and affected W2 flows. Eighteen attached Ready screenshots live in ignored `rai-web/playwright-report/`; representative1440/834/390 screenshots were visually inspected for the expected read-only state. Captured child logs pass existing assertNoLeak after orderly shutdown.
- Root Markdown links, frozen source hash and `git diff --check`: pass. Final cleanup check found zero generated browser databases on the assigned service and no listener on58859. The assigned Compose service remains running; no volume teardown.

## Proof files (local only)

Raw logs remain in the private temporary workspace; they are not committed. The red test was subsequently strengthened with explicit final GET observation, IT own-lane empty assertions, shutdown log audit and screenshots before the final green run; the recorded two red failures identify the unchanged application defect, not a final-file hash equivalence claim.

| Local proof | SHA256 |
| --- | --- |
| `/tmp/rai-w3-int-ready-red.log` | `2cc14f6e29d1ca52feebc5ecc51ed17f593ed6529f9891b9983ad9dc5ae090a4` |
| `/tmp/rai-w3-int-ready-browser-final.log` | `207e89361fda10424f9091a01b971dec5851387912b80fbeb05ea86f3da4ff21` |
| `/tmp/rai-w3-int-ready-units.log` | `e20970b5abe735025603f80bb02dd2dc33cc24bd2f939a7cf54baeaf295696b8` |
| `/tmp/rai-w3-int-ready-type.log` | `82d58ce04ec96677be35f425ad184bcf3607890a82089123b04a9b9275090916` |
| `/tmp/rai-w3-int-ready-lint.log` | `b7f315b8d30fa0ee5de1707340379e926b6e20a8485211e45e6b92e2ce580b41` |

## Tested source fingerprint

| Owned path | SHA256 |
| --- | --- |
| `rai-web/web/src/screens/case/view-model.ts` | `15312572c187bd074b7e9e06c7d956e48009b8a086306a6139c1ee5a39999df5` |
| `rai-web/web/src/screens/case/reviewer-workspace.tsx` | `994497b549bd240dd4192dd0de1d5bb4b6406eb13dc63d9995e2e534914d56c5` |
| `rai-web/web/src/screens/case/case-screen.tsx` | `1c6b2626a5fdebc0119108583a88afeb0777327cb18edeb4cf5cc8ee3f762ee8` |
| `rai-web/web/src/screens/case/view-model.test.ts` | `46500f1c26293c3e02efbe38dc963289dab28a466519c85c6f749cf755baee55` |
| `rai-web/tests/browser/w3-int-ready-readonly.spec.ts` | `76f6e2387316f0d8c402869dc4c91268ca6ac8895ea3152bf5221efd91925aa8` |

## Delivery boundary

This is local author verification, not independent review or full INT acceptance. Hypatia review remains pending. Parent Heisenberg owns the shared journey assertions and assembly; final IT expectations must use own-lane empty state, while owner verifies the AI/COE persisted finding. Carver owns the fresh whole-browser walkthrough after assembly. The prior full-proof UI fingerprint is invalidated. No full integration suite was run here, no model/A06 acceptance is claimed, and no push/PR/merge occurred. Existing in-review policy and issue35 remain unchanged.
