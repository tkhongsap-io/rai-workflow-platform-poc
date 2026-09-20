# Data and authority contract

Status: conceptual schema, no database chosen or migrations created.

## Inherited case fields

Preserve registry_id (desk-local), source_record_id (known ID or Unknown), use_case_name, business_unit, business_owner, technical_owner, risk_tier, privacy_status, security_status, rai_status and ai_readiness_status. Do not import control-tower monitoring/health fields. Proposed use_case_group supports the source's group search requirement; it is inherited from the registry schema but absent from the shortened v1 field list, so confirm before implementation.

The source record ID is a reference, not proof of external registration or a promise to synchronize. Use Unknown rather than invented external IDs. Business value remains outside this desk.

## Proposed entities

| Entity | Minimum contract |
|---|---|
| Case | Stable local ID, inherited fields, owner/BU scope and current-version reference |
| Pack version | Immutable submission ID, parent version, submitting actor/time, checklist_template_version, QC/risk config revision, stage context |
| Artifact slot | Slot 1-9, disposition/reason, immutable blob reference and hash, filename/media metadata |
| Lane decision | Version, lane, actor/role, decision, timestamp, feedback and observed QC run |
| QC run/finding | Version, trigger, rule revision, evidence location, metric/denominator/threshold, result or unavailable status |
| Disposition event | Finding, actor, fixed/waived/N/A, reason, evidence and timestamp; never overwrite prior finding |
| Notification | Event/version/lane/recipient, case link, delivery status, retry and deduplication identity |
| Configuration revision | Admin actor/time, template identity, rules/thresholds/SLA revision |
| Audit event | Actor, action, target version, correlation ID, time and before/after state references |

All approval and completion transitions are transactional or provide equivalent integrity. Do not make AI-generated fields authoritative without human review. Historical packs remain bound to their rules revision; applying new rules must be an explicit recorded recheck, never silent retrospective mutation (proposal).

## Access and retention

Owner sees own cases, BU SPOC sees BU cases, three reviewer roles see all cases and act only in their lanes, Admin manages configuration. Admin does not implicitly receive lane-approval authority. Multi-role conflict/self-approval policy and defect-disposition permission are pending decisions.

Authorization must cover direct IDs, search/filter results, file downloads, QC evidence and notification deep links. Files live within the application's controlled storage in v1, not SharePoint and never Git. Encryption/key custody, deletion/retention/legal-hold rules and audit retention require DPO/Security approval before real data. Immutable business versions do not exempt personal data from approved deletion policy.
