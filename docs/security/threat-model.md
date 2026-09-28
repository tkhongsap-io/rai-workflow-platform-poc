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
| Networked test exposed with arbitrary Google login | Localhost-only development mode; allow-list/AD network mode; fail-closed configuration tests. W7 evidence (2026-09-28, W7-08): [A01 network clause suite](../../rai-web/tests/integration/w7-08-network-a01.test.ts): only allow-listed, provider-verified accounts get a session, with exactly their listed roles; an allow-list change applies at the next sign-in; an `http` base URL refuses start. On loopback in `network` mode; no non-loopback bind performed (D10) |
| Corrupt storage or accidental release | Restricted backup/restore and rollback rehearsal before real-data exposure |
| Parser exploit, hang or memory blow-up while QC reads a document (2026-09-27, W4-01; [ADR-0006](../../adr/0006-qc-engine-and-extraction.md), provisional; WA-D08) | Hand-written parsers on Node built-ins, no new dependency; one fresh worker process per artifact with an empty environment, IPC only, a heap cap, a wall-clock kill and an output cap; no database, filesystem or network module in the worker (module-graph test); every limit fails closed to a visible `unavailable` content part; the W0-08 hostile set fed to the extractor ends as a clean refusal (W4-05b-d). A container or sandbox for real data stays a D08 question |
| Document text or hostile instructions reaching a model (2026-09-27, W4-01; ADR-0006, provisional; WA-D08) | The model may only propose claim candidates; deterministic rules decide findings. Segments are placed in a JSON data block marked as data, never instructions; no tools, secrets, case IDs or other cases' text in the prompt; output validated before use (every field value a substring of its segment), any violation is `runner_error`; injection, fabrication and prompt-disclosure probes show zero successes (W4-07, W4-10) |
| Case data sent to an external model provider (2026-09-27, W4-01; ADR-0006, provisional; WA-D08) | No provider and no key exist: `QC_MODEL` takes only `disabled` (default) and `local-fake` (a test-only fixture excluded from the build). No call leaves the machine. Adding a provider needs a D08 row and a new ticket; D08 stays open |

Data use, retention, deletion, model provider, transfer region, telemetry and subprocessors require review before real-case ingestion. Only synthetic fixtures until then. Define severity remediation windows, incident ownership and shutdown paths before release; none are operational today.
