# Acceptance contract (planned tests)

None of these product tests has run: no application exists. Source: [v1 specification](product/source-spec.md). Proposed edge-case semantics remain subject to [decisions](product/decisions.md). Use synthetic fixtures first; retain actual test outputs when implementation begins.

| Requirement | Test ID and observable proof |
|---|---|
| R1 | A01: each of six roles sees only its authorized cases and actions, including direct URL/API access. Owner/BU boundaries hold; reviewer acts only its lane; Admin configuration is not implicit approval. Local Google works only on localhost; networked access requires allow-list/AD; production rejects Google and accepts configured True AD roles. |
| R2 | A02: owner and BU SPOC create/submit nine slots; attached, not yet, missing and N/A with reason remain distinct; non-vendor DPA/SOW default N/A. Known external ID or Unknown retained, no fake official record. Missing documents raise findings but submit succeeds. |
| R3 | A03: versioned seven-question rubric matches approved reference cases; missing evidence never silently becomes Low. High displays Council confirmation requirement and opens all three lanes. Test exact rubric boundaries after D07. |
| R4 | A04: one submission atomically opens three parallel lanes with specified document mappings; BRD shared, supporting docs not a lane gate. Confirm AI/COE mapping under D02 before freezing expected values. |
| R5 | A05: lane-open, send-back, completion and SLA-breach test emails contain correct authorized case links; recipient cannot gain access from link alone. Delivery failure does not lose committed review state; retry avoids duplicate events under approved D06 policy. No external mail during synthetic test. |
| R6 | A06: search by source_record_id, status, owner, group or all returns only authorized review cases; pagination/counts do not reveal others. D11 must settle group field. |
| R7 | A07: send-back creates N+1 while N documents, findings and decisions remain readable and immutable; latest version is explicit. Concurrent send-backs, stale approvals and replay use the approved D05 rules. |
| R8 | A08: upload, submit and approve attempt each trigger appropriate QC and expose findings before reviewer decision. False Yes without metric/denominator/threshold/evidence is flagged; extraction accuracy is not hallucination rate. v1.0 strict bands H<1%, M<2%, L<3% test below/equal/above; v2.0 never inherits them. Classic ML uses matching metric or justified N/A. QC failure is visible, not clean-pass; no soft finding blocks submit/review. |
| R9 | A09: send-back requires artifact-specific adequacy feedback. Three current-version approvals plus disposition of every finding alone enables Ready for launch. Fixed/waived/N/A dispositions are attributable; waiver/N/A require reasons. Open findings prevent only that final transition. Readiness does not claim Council or ITSM authorization. |
| R10 | A10: Admin edits versioned templates, QC rules, SLA and production group mapping without redeploy; unauthorized edits fail. Existing pack evidence stays reproducible; subsequent packs use published config under documented activation rules. |

## Locked-rule traceability

| Rule | Proof |
|---|---|
| L1 | A05, A06, A07, A08, A09 |
| L2 | A04; no lifecycle stage engine |
| L3 | A02; external register stays authoritative |
| L4 | A01 production identity |
| L5 | A04; review-desk scope only |
| L6 | No register write integration or register-completion claim in code/UI |
| L7 | A02, A08 soft QC |
| L8 | A09 final readiness conditions |
| L9 | Documentation-only file audit now; explicit start evidence before code |
| L10 | A02 known ID/Unknown |
| L11 | A01 local vs network identity |
| L12 | A08, A10 versioned configuration |

## Cross-cutting negative cases

Before release, test unauthorized artifact download, cross-BU access, malicious documents and prompt injection, unsupported template version, concurrent final approvals with new findings, mail replay, config tampering, inaccessible evidence, and backup restoration. No model output may approve a lane or grant permissions. Upload security checks can reject unsafe files; that is distinct from soft document-quality QC. See [threat model](security/threat-model.md) and [evaluation](evaluation/plan.md).

Product acceptance requires recorded outputs, fixture/rule/model versions and responsible human review. Documentation checks establish coverage only. Operator rehearsal, live identity and production release are separate gates in the [implementation plan](implementation-plan.md).
