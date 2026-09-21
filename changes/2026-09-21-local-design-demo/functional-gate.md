# Functional acceptance gate

Owner clarification, 2026-09-21: small visual differences are acceptable. Functional features and user journeys, verified through unit and localhost end-to-end tests, are the hard gate. This supersedes the earlier literal zero-pixel blocker; it does not authorize production integrations.

## Plan and done criteria

1. Map the design requirements LD01–LD10 to executable checks. Retain the exact source/provenance and earlier visual evidence.
2. Run the existing unit and browser suites against the current local app.
3. Extend coverage of previously under-tested UI interactions: queue filters, save/discard and document states, role restrictions, risk, notifications and frozen history. Check negative validation as well as successful actions.
4. Fix any observed functional defects, add regression coverage and rerun affected suites plus the main journey.
5. Record actual results, limitations and a team walkthrough. Completion requires passing unit and browser suites and no unresolved functional defect in the covered synthetic journeys.

## Scope

This is the reviewed frontend prototype with synthetic cases, documents and QC. It must demonstrate all designed workflows. Real authentication, uploaded-file storage, live AI evaluation, mail delivery, persistence and production governance acceptance are not implemented and must not be claimed by these tests.

## Evidence map

| Requirement | Functional evidence |
|---|---|
| LD01 local execution | Local browser load and Python loopback server |
| LD02 design | Original source equality test and 58 existing layout comparisons; small differences accepted |
| LD03 queue/new case/nine slots | Unit scope/filter/create tests; browser creation, filtering and pack editing |
| LD04 send-back/version/history | Unit immutable snapshot and approval reset tests; browser v1→v2 journey and history |
| LD05 Ready/dispositions | Unit negative/version checks; browser approval-with-findings and final dispositions |
| LD06 six roles | Unit action matrix; browser scoped queue and restricted controls |
| LD07 QC/risk/notifications/Admin | Unit version/outage/config/risk tests; browser additional/extended checks |
| LD08 reset/limits | Browser reset plus demo README |
| LD09 repeatability | tests/*.test.mjs and exported browser test suites, actual runs below |
| LD10 defects/regression | Record findings and reruns below; zero-bug guarantee is not asserted |

## Run results

**Passed on localhost after fixes.**

- `node --test tests/*.test.mjs`: **22 passed, 0 failed**. Includes 11 invalid configuration combinations, a stale non-Admin publication callback and discard recovery, in addition to workflow/version/source tests.
- `runReviewJourney(page)`: **PASS**, re-executed after fixes. SPOC → submission with findings → AI/COE send-back → Owner BRD correction → v2 → all three approvals → awaiting disposition → waivers → Ready.
- `runAdditionalChecks(page)`: **PASS**, re-executed after fixes. New case validation/Unknown/non-vendor defaults; Admin revision; preview widths; QC outage; checklist v2 isolation; reset.
- `runFunctionalGate(page)`: **PASS** after an initial failed run exposed a regression and it was repaired. Covers search/status empty states, N/A reason rejection, save/discard, Missing versus Not yet, saved document restoration, Unknown/High risk, three lanes under High risk, frozen snapshot, notification link, six-role approval matrix and invalid/valid Admin publication.
- `runDispositionChecks(page)`: **PASS**. Fixed disposition rejects absent explanation/evidence; N/A rejects absent rationale; valid simulated decisions permit Ready only after the last finding is disposed. Waiver is covered by the main journey.
- Browser error log: **empty** after the three main suites. The disposition suite also completed without a thrown error.
- Source/provenance tests prove the original export unchanged and local entry equal to that export plus the enumerated bootstrap and functional corrections.

## Defects found and fixed

1. **Inherited Admin defect:** a negative SLA could be published. Local validation now requires a nonblank template version, positive integer working-day SLAs and ordered percentage thresholds `0 < High < Medium < Low <= 100`. Invalid settings cannot publish; the handler validates independently of the button.
2. **Regression caught before handoff:** the original template bound Discard to the same disabled flag as Publish. The first validation fix therefore disabled discard for invalid edits. Discard now has its own dirty-state flag. Both unit and browser recovery checks pass.
3. The exploratory empty-state test initially matched two Clear filters buttons. The test now explicitly selects the first; both are legitimate UI controls. This was a test-locator issue, not an application defect.

The original `demo/reference/Main.dc.html` and component remain immutable. Intentional corrections are enumerated in `demo/reference/local-adaptations.json`. Prior visual comparisons describe the pre-validation version; corrected validation text and discard binding intentionally differ. No pixel-equality claim is needed under the owner's revised gate.

## Handoff decision

The agreed synthetic-demo functional gate is met. No unresolved failure remains in these tested journeys. This is not exhaustive state-space testing, independent security review, backend authorization proof or production acceptance. Real uploads/storage, authentication, actual QC inference, delivery of email and persistence remain future implementation. Risk uses labelled scenarios rather than the unconfirmed seven-question instrument. Role mappings and SLA dates remain illustrative.

Run the demo with `python3 demo/serve.py`, open http://127.0.0.1:5173/, and use Scenario 1 to walk the team through the main journey. Reset returns to the starting fixture. After this verification, the owner authorized committing all changes and merging through a PR. This authorizes repository delivery only, not deployment.
