# Data and authority contract

Status: conceptual schema, no database chosen or migrations created.

## Inherited case fields

Preserve registry_id (desk-local), source_record_id (known ID or Unknown), use_case_name, business_unit, business_owner, technical_owner, risk_tier, privacy_status, security_status, rai_status and ai_readiness_status. Do not import control-tower monitoring/health fields. use_case_group is inherited as a required field (D11, 2026-09-21); its value list is Admin configuration. It supports the source's group search requirement. Confirmed desk-local (Ta, 2026-09-21), not inherited: a vendor/non-vendor indicator `vendor_involved` (needed for the DPA/SOW default N/A rule in the source spec, W1-04) and a model-type indicator `model_type` (LLM / classic-ML / other; needed for the classic-ML metric-or-N/A rule in source-spec QC). A separate model version appears only in the design and TEST_RUNS scenario 3; it is not a contract field. Confirm `vendor_involved` and `model_type` under W0-04 before W1-02/W1-04 start. The four inherited status fields (`privacy_status`, `security_status`, `rai_status`, `ai_readiness_status`) are registry field names with no desk semantics recorded yet; Ta confirmed on 2026-09-21 (register, "W0-04 fields") that they are read-only projections written only by the workflow: DPO approval → `privacy_status`, IT/Security approval → `security_status`, AI/COE approval → `rai_status`, Ready → `ai_readiness_status`. Under either answer they are never a second record of a lane decision or of Ready for launch (L8): the lane-decision entity and the Ready transition remain the only authority, and no owner or BU SPOC write may make one of these fields read as an approval.

The source record ID is a reference, not proof of external registration or a promise to synchronize. Use Unknown rather than invented external IDs. Business value remains outside this desk.

## Proposed entities

| Entity | Minimum contract |
|---|---|
| Case | Stable local ID, inherited fields, owner/BU scope and current-version reference; proposed desk-local fields (not registry fields, confirm under W0-04): `vendor_involved` (drives the slot 3/4 non-vendor N/A default) and `model_type` (drives the classic-ML metric-or-N/A QC rule) |
| Pack version | Immutable submission ID, parent version, submitting actor/time, checklist_template_version, QC/risk/SLA config revision, stage_context (idea / pre-build / pre-launch, D11; QC input only, never a lifecycle state) |
| Artifact slot | Slot 1-9, disposition/reason, immutable blob reference and hash, filename/media metadata |
| Lane decision | Version, lane, actor/role, decision, timestamp, feedback and observed QC run |
| QC run/finding | Version, trigger, rule revision, evidence location, metric/denominator/threshold, owning lane (AI/COE, DPO or IT/Security, assigned by the W0-06 rule under D05), result or unavailable status |
| Disposition event | Finding, actor, fixed/waived/N/A, reason, evidence and timestamp; never overwrite prior finding |
| Notification | Event/version/lane/recipient, case link, delivery status, retry and deduplication identity |
| Configuration revision | Admin actor/time, template identity, rules/thresholds/SLA revision |
| Audit event | Actor, action, target version, correlation ID, time and before/after state references |

All approval and completion transitions are transactional or provide equivalent integrity. Do not make AI-generated fields authoritative without human review. Historical packs remain bound to their rules revision; applying new rules must be an explicit recorded recheck, never silent retrospective mutation (proposal).

## Access and retention

Owner sees own cases, BU SPOC sees BU cases, three reviewer roles see all cases and act only in their lanes, Admin manages configuration. Admin does not implicitly receive lane-approval authority. Under D05, waived and N/A dispositions belong to the finding's owning lane, the owner may propose "fixed" for that lane to confirm, and no owner or BU SPOC on a case may approve a lane on it.

Authorization must cover direct IDs, search/filter results, file downloads, QC evidence and notification deep links. Files live within the application's controlled storage in v1, not SharePoint and never Git. Encryption/key custody, deletion/retention/legal-hold rules and audit retention require DPO/Security approval before real data. Immutable business versions do not exempt personal data from approved deletion policy.
