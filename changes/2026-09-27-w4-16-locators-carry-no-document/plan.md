# Plan

1. Board CLAIM on `lane-a-workflow-server.md`. Change frame (this folder).
2. RED:
   - `shared/src/qc/validate.test.ts`: the new shapes pass; `heading`/`sheet`, index 0, a non-integer, a bad A1 reference and an unknown key fail.
   - `server/src/qc/evidence-view.test.ts` (new): `evidenceView` serves ordinals, legacy `heading`/`sheet` rows as the bare kind, and drops malformed ordinals.
   - `fixtures/src/substitutes/qc/scripts.test.ts`: no bundled text locator; a text locator is refused.
   - `server/src/qc/extraction/protocol.test.ts`: a legacy text locator inside the caps is `crash`.
   - `web/src/screens/case/view-model.test.ts`: `evidenceLocations` returns the ordinals and a label per entry (its `heading` literals move to the no-text shape).
   - `tests/integration/w4-12-qc-runs.test.ts` and `tests/browser/w4-12-qc-log.spec.ts`: served locator and rendered line carry the ordinal.
3. GREEN: `shared/src/qc/types.ts`, `shared/src/qc/validate.ts`, `shared/src/schemas/review.ts`, `server/src/qc/repository.ts` `locatorView`, `server/src/qc/extraction/{port,protocol}.ts`, substitute scripts, `web/src/screens/case/{view-model.ts,finding-list.tsx}`, locales (keys under `review.evidence.*`, sorted).
4. Documents: W0-07 3.3 and W0-02 section 7 dated notes.
5. Full gate, one suite at a time, logs under `/tmp/rai-w4-16-locators-carry-no-document-logs/`.
6. review.md, DEVLOG, CHANGELOG; commit, push, verify remote head, open the PR ("Refs #202").
