# W3 engineering evidence map

Source-attributed implementation proof is linked from [the exit review](review.md). This map preserves partial and future acceptance boundaries; it is not Ta/operator acceptance.

| Requirement | Implemented boundary and evidence | Remaining boundary |
|---|---|---|
| A01 local scope | Fixture identities; direct API/file/mail-link checks; queue scope/count/filter negatives; owner/BU/reviewer/Admin action guards; same-case keyboard journey | Manual Google loopback sign-in pending Ta; network/True AD and production roles belong to W7/W8 |
| A02 pack | Real create/upload/save/submit, native file chooser, nine-slot states and synthetic fixtures; missing evidence does not prevent submit | Real documents/data remain gated by D08; no real QC quality claim |
| A04 lanes | Atomic three-lane opening, frozen mappings and current-version reviewer actions; parallel lane and negative tests | No expansion to lifecycle/Council/ITSM |
| A05 notifications/SLA | Committed ordinary event mail; configured-recipient daily digest; rollback, dedup/retry and frozen working-day cases; actual file-sink links require sign-in and scope; failure does not undo workflow | File sink only; external mail and exactly-once delivery not claimed |
| A06 queue | Real-server cards/filter/history/pagination tests at three widths and independent scoped populations; 1,000-case timing baseline recorded for six scoped/search profiles | Synthetic sequential measurements are not concurrent production capacity |
| A07 versions | Immutable v1 across restart; send-back, v2, stale/idempotent/concurrent negatives and full re-review | No substitute for retention/backup/operator acceptance |
| A09 completion | Named-artifact feedback, slot-1 fixed proposal/owning-lane confirmation, three approvals and atomic Ready; open findings and self/Admin-approval negatives | Issue #35/#53 remain open for slot-5/9, pack and unavailable owning-lane semantics; full A09 is not claimed |
| A11 attribution | Existing immutable audit tests plus actual workflow events, mail provenance and correlation | Ordinary mail requires case audit provenance; daily digest uses its separately reviewed durable job provenance |
| OBS | Real dependency probes, pending migrations/outage responses, safe suite-wide captured logs, unavailable/late-QC durability and actual Admin failure page | Synthetic configured QC/mail adapters; not AI-use-case monitoring, production observability acceptance or real QC |

A03 (risk), A08 (real QC) and full A10 (Admin authoring/AD mapping) remain future packages. W3's policy/diagnostic subset does not complete those acceptance IDs. W4–W8 require separate authorization. Ta and Nakhun retain acceptance of proposed workload/latency targets and later operator rehearsal.

## Release and review record

The [delivery PR ledger](pr-ledger.md) records prerequisite and implementation PRs; the exit review records integrated proof. #35/#53 remain open. W3-06 engineering evidence and M3 human acceptance are different states.

PR120 merged while browser CI was still pending because the auto-merge command merged immediately. Subsequent PR CI, main CI and actual-main full verification all passed. This exception remains disclosed; later PRs require an exact-reviewed-head, all-checks-success preflight before merge. Cancelled or superseded CI is not recorded as success.
