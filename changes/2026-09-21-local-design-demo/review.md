# Local demo verification — 2026-09-21

## Current acceptance

Superseded blocker: Ta accepts small visual differences and requires functional verification. The [functional gate](functional-gate.md) passed after Admin validation fixes: 22 unit/provenance tests and four localhost browser suites. The capture limitations below remain historical evidence, not an active blocker. Original export remains unchanged; the local entry now also includes declared functional corrections.

## Earlier implementation result

Runnable local demonstrator implemented from the original authored Claude template, CSS and component. A local binding adapter replaces the hosted runtime. PRD and plan were established before this implementation. Production W0–W8 and publication remain outside scope; changes are uncommitted on codex/local-design-demo.

## Executed evidence

- `python3 demo/serve.py`: serves demo/ on 127.0.0.1:5173; HTTP 200 and browser load verified. Restarted after the previous session's process stopped.
- `node --test tests/*.test.mjs`: 19 passed, 0 failed. Seventeen actual-component tests plus two source/provenance tests.
- Full browser journey passed, then repeated: SPOC submission despite three findings; AI/COE send-back; corrected BRD; v2 resubmission; each reviewer's approval; still awaiting disposition; IT and DPO waiver dispositions; Ready only after the last disposition.
- Additional browser suite passed: required-name validation; new case with Unknown source and DPA/SOW N/A; Admin publishes revision 4/template 1.5; 834/390/1440 controls; QC outage produces three explicit findings; checklist v2 does not inherit v1 SL2.1 numbers; reset restores fixtures.
- Browser error log was empty after these actions.
- A browser defect was found and fixed: native option labels were blank because interpolated text was wrapped in spans. The adapter now assigns option textContent. All later tests used this correction.
- Frozen product-source SHA remains `92c4f7123058b8fec3c2ba7abdf10538fad034778624b0675975b39de440b354`.

## Design fidelity evidence and limit

The entry file is mechanically proven equal to the full authored export except the declared script/viewport replacement. The component is not independently reimplemented. Measured visible controls match exactly after subtracting the 274px local outer-canvas offset:

| State | Preview width | Controls compared | Geometry/style/text differences |
|---|---:|---:|---:|
| Queue | 1440 | 30 | 0 |
| Queue | 834 | 28 | 0 |
| Queue | 390 | 28 | 0 |
| Documents | 1440 | 46 | 0 |
| Admin | 1440 | 32 | 0 |
| Admin | 834 | 31 | 0 |
| Admin | 390 | 31 | 0 |

The table above is the earlier sampled text/control check. An expanded pass now records **58 matched-state comparisons**, covering all positive-size rendered elements except script/style/option nodes and adapter interpolation spans. It compares tag, artboard-relative x/y/width/height and 25 computed CSS properties, including borders, shadows, backgrounds, spacing and SVG fill/stroke. Every comparison had equal element counts and equal measured styles. The largest coordinate difference was 0.0001220703125 CSS pixels, below the explicit 0.001 CSS-pixel numerical tolerance. This tolerance handles coordinate subtraction precision; it does not establish raster equality.

Expanded coverage at 1440/834/390: queue, documents, risk evidence, submit dialog, review lanes, send-back dialog and validation, sent-back history, frozen submission dialog, document picker, approval dialog, awaiting disposition, disposition dialog, Ready state, notifications closed/read and open drawer, Admin, new-case form and its required-field validation. One additional Unknown-risk comparison was made at 1440. The notification drawer was explicitly reopened after each width change because the authored width control closes it. An original hosted radio checked-state inconsistency was observed: the risk state changes correctly, but native checked-state reporting differs; the local adapter updates the native property.

Raw expanded results: [expanded-geometry-results.json](../../tests/visual/expanded-geometry-results.json). Reusable read-only comparator: [compare-artboards.mjs](../../tests/visual/compare-artboards.mjs). Earlier sampled text evidence remains in tests/visual/geometry-results.json. Expanded fingerprinting does not compare text directly; exact source preservation and separate text/browser assertions provide that evidence. Browser error log was empty after the expanded pass. Both reference and local prototype were reset to Scenario 1 / Owner / 1440 for handoff.

The queue screenshot was visually inspected. Captures are JPEG, with the 1500×1220 requested artboard represented in the upper-left 750×610 pixels of the returned image. The decoded matching crops have mean absolute channel differences R=0.5701, G=0.5678, B=0.6085 on a 0–255 scale. Claude collaboration chrome/cursors and JPEG compression affect exact pixel comparison. No claim of zero-pixel equality is made. The earlier queue-1440/queue-cropped files predate the dropdown fix and are historical diagnostic evidence only.

LD01 and LD03–LD09 have local evidence. LD02/LD10 have source/layout evidence but the literal whole-workflow, zero-pixel acceptance criterion remains unverified. A lossless matched reference capture is needed to close that final visual proof; changing the acceptance criterion to a tolerance requires the owner's decision.

## Boundaries

Role switching is not authentication; no backend, persistence, real upload, live QC or email exists. State is in memory and refresh resets it, as in the source design. SLA dates and mappings remain illustrative. The browser suites are checked-in reusable functions, executed through Codex's browser API, not a claimed CI job or bundled standalone Playwright runner. Cross-browser and complete accessibility acceptance are not established.

## Final capture audit

The previous continuation made progress by saving 58 comparisons and completing notification/new-case checks. On the subsequent audit, the demo still loaded the expected queue and the screenshot API again returned a JFIF JPEG (header FF D8 FF E0). The documented screenshot options expose clipping/full-page capture, not lossless format selection; available browser/tab capabilities expose no lossless capture control. Both screenshot entry points had already been tried. Repeating compressed captures cannot prove zero-pixel equality.

The remaining blocker has persisted across three consecutive resumed goal turns. Functional/demo delivery is available, but the overall goal is blocked on the requested literal visual certification. Closing it requires a matched lossless reference/local capture facility, or an explicit owner decision to accept the documented source/layout comparison instead. No acceptance criterion has been weakened, and no additional application change is justified by the current evidence.
