# Intent: the desk-health list names the lane that owns each QC outage

Follow-up recorded by W2-05 ([review](../2026-09-25-w2-05-owning-lane/review.md) section 5; observability contract, the `unavailableQc` entry). Since the owning-lane rule was recorded on 2026-09-25, every QC outage is a finding its lane must disposition, but the Admin desk-health list still showed the outage without that lane. Ta chose on 2026-09-26 to run the small fixes in parallel with the W4 gate briefs; this is the one fix that needs no new decision.

Scope: W3-07 (authorized under D03), synthetic data only. The report's shape already allowed the optional field and the Admin page already renders it. No new decision, no migration.
