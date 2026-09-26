# Specification

Done when:

1. Lane-opened recipients are filtered per case: a reviewer whose grants include `bu_spoc` for the case's `business_unit_id` is left out of that case's `lane_open` rows. On a case of another business unit the same reviewer still gets the mail (W0-05 T20). The owner case is untouched.
2. The case page, on the latest version, shows a note to a lane reviewer who is BU SPOC of the case's business unit, naming the lanes and the business unit, in Thai and English. It is derived in the SPA from the session's own grants and the case's `businessUnitId`, so no read shape changes; the API still answers 403 (display only, as W0-05 section 6 allows).
3. W0-05 3.3 table, its prose, section 8 row and T28; W0-06 4.11 carry the rule. The register row's pointer "W0-06 section 5" is corrected to 4.3(f) and 4.11, and the W3-F3 row's pointer to 4.11.
4. Tests: `open-lanes.test.ts` (filter, and no filter without the map); `view-model.test.ts` (note only for the BU-SPOC conflict, not for the owner, not without a lane grant); `tests/integration/w3-f2-spoc-reviewer-mail.test.ts` (HR case: DPO mail to `fx-user-dpo` only; CM case: to both); `w2-int-07-reviewer-workspace.spec.ts` (Rattanaporn on RAI-2000-0005 sees the note in th and en, no approve button, axe). Full suite green; two reviewers; CI.
