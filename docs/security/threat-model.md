# Threat model and engineering risk

Status: proposed controls, not implemented. Owner: Ta for planning; Security/DPO and production accountable owner must review before exposure.

Documentation setup has no runtime or data-processing behavior. Planned workflow starts at playbook R2 (material approval workflow); sensitive/untrusted documents and eventual email writes trigger escalation. Use provisional **R3 engineering controls** until qualified review records a justified classification. This is distinct from High/Medium/Low tiers proposed for individual AI cases and is not a compliance certification.

| Threat / boundary | Required control and future proof |
|---|---|
| Owner reads another BU's case via URL/search/download | Server-side scope checks before retrieval; cross-role negative tests |
| Document tells model to approve or reveal another case | Isolated untrusted content; no model approval/tools; injection and exfiltration probes |
| Malicious archive/PDF, oversized upload or decompression bomb | Type/size/resource constraints and isolation; reject unsafe bytes, surface safe error |
| Stale approval or repeated send-back | Version-scoped checks, idempotency, atomic state/audit; concurrency tests |
| Credentials/PII in prompt, logs or email | No secrets in prompts; minimized protected logs; deep links instead of attachment contents |
| Unauthorized Admin approval/config drift | Separate config and lane authority; version configuration, record actor/time; negative tests |
| QC/model outage presented as clean evidence | Explicit unavailable finding, no hidden fallback, reviewer-visible status |
| Email fails or repeats | Durable event identity, bounded retry and observable status; test delivery failure |
| Networked test exposed with arbitrary Google login | Localhost-only development mode; allow-list/AD network mode; fail-closed configuration tests |
| Corrupt storage or accidental release | Restricted backup/restore and rollback rehearsal before real-data exposure |

Data use, retention, deletion, model provider, transfer region, telemetry and subprocessors require review before real-case ingestion. Only synthetic fixtures until then. Define severity remediation windows, incident ownership and shutdown paths before release; none are operational today.
