# Persistence and artifact store (W0-04)

**Status:** W0 interface spec, written 2026-09-21 for ticket W0-04 (issue [#9](https://github.com/tkhongsap-io/rai-workflow-platform-poc/issues/9)); reconciled with the sibling specs at the W0 exit review ([W0-09](../../changes/2026-09-21-w0-exit/review.md), 2026-09-21; each applied change is marked "W0-09:"). Human review required before W1-00 starts. Nothing here is implemented; the tickets that implement it are named in [Consumers](#consumers).
**Proves / feeds:** A07 (immutable versions, one successor, idempotent replay), R7 (keep every submission, always know the latest); enables A11 (append-only audit) and the W1 restart evidence.
**Stack:** concrete for [ADR-0003](../../adr/0003-stack-and-deployment-boundary.md) (D04: Node 24, Fastify, Drizzle ORM, Postgres 16, local filesystem blob store, `node:test`, Playwright). The boundaries in [Layering](#layering) are stack-neutral in intent: a different database or blob backend replaces the adapter, not the rules.
**Decisions carried as written:** D02 (lane mapping is a versioned constant recorded on each submitted version), D05 (dispositions append, owning lane records waived/N/A, owner proposes fixed), D06 (notification dedup key, retry count, operator recipients as configuration), D11 (`use_case_group`, `stage_context`), D12 (message keys, not strings, in stored findings), and the register row **W0-04 fields**. D07-D10 are left open; [Retention and deletion](#retention-and-deletion-options-for-d08) lists options for D08 and chooses none.
**Source rules that bind this document:** [data contract](../product/data-contract.md), [workflow contract](../product/workflow.md), [acceptance](../acceptance.md) A07/A09/A11, [threat model](../security/threat-model.md), the frozen [source spec](../product/source-spec.md) (L3, L6, L8, L12; never edited), and the W0-04 section of the [W0 technical contract](../delivery/w0-technical-contract.md#w0-04--persistence-and-artifact-store-spec).

## Contents

1. [Scope](#scope) and [Consumers](#consumers)
2. [Layering](#layering)
3. [Data model](#data-model)
4. [Desk-local Case fields and the four status projections](#desk-local-case-fields-and-the-four-status-projections)
5. [Immutability](#immutability)
6. [Artifact store](#artifact-store)
7. [Transactions and idempotency](#transactions-and-idempotency)
8. [Restart proof](#restart-proof)
9. [Audit log](#audit-log)
10. [Schema evolution](#schema-evolution)
11. [Retention and deletion: options for D08](#retention-and-deletion-options-for-d08)
12. [Interfaces](#interfaces)
13. [Error contract](#error-contract)
14. [Test substitutes and test map](#test-substitutes-and-test-map)
15. [Configuration and commands handed to W0-02](#configuration-and-commands-handed-to-w0-02)
16. [Open items](#open-items)

## Scope

This document specifies the two boundaries the [architecture table](../architecture/README.md#boundaries-owners-and-tickets) assigns to W0-04:

- **Case metadata, configuration revisions and audit store**: immutable submitted versions, append-only findings, dispositions and audit, schema evolution.
- **Private artifact storage**: protected bytes keyed by content hash, metadata, authorized download. Upload *safety* (allowed types, size limits, sniffing) is W0-08; this document says where the accepted bytes go and how they are referenced.

Out of scope, owned elsewhere: sessions and identity (W0-03), the authorization matrix and who may read audit rows (W0-05), transition preconditions and the owning-lane rule for findings (W0-06), QC and mail behaviour (W0-07), log redaction and readiness (W0-10), request/response shapes and repository paths (W0-02). Where this document needs one of those, it names the ticket and states the assumption it makes.

## Consumers

| Ticket | Uses from this document |
|---|---|
| W1-00 | Schema for `case`, `pack_version`, `artifact_slot`, `configuration_revision`, `audit_event`, `idempotency_key`; migration tooling and the explicit migrate step; DB roles; the audit store with no update/delete path; the configuration-revision seed and its immutability test |
| W1-02 | `case` columns, the desk-local fields, the projection write rule and its rejection test |
| W1-03 | `artifact` metadata, the blob store interface, content hashing, private path layout, authorized download, Thai filename handling |
| W1-04, W1-05 | Draft slot rows, the submit freeze (`pack_version` frozen columns, manifest hash), the restart proof |
| W2-01 to W2-04, W2-06 | Transaction recipes for submit, decide, send back, resubmit and Ready; expected-version and idempotency-key handling; projection writes |
| W2-05 | `qc_run`, `qc_finding`, `disposition_event` and their append-only rules |
| W3-03, W3-04 | `notification` row identity, dedup key and retry columns |
| W3-01 | Query constraints the queue must respect (scope filter inside the query, never after) |
| W3-07 | Correlation ID column and store-reachability readiness |
| W7-00 | Backup/restore rehearsal, `store:verify`, migration-against-restored-backup test |
| W6 | Configuration revision editing arrives here; the revision table is fixed now |
| D08 gate (ADR-0005, reserved) | The retention and deletion options |

## Layering

Stack-neutral intent, then the D04 mapping.

```mermaid
flowchart TB
    Routes[Fastify routes: authorize first, then act] --> Workflow[Workflow services: submit, decide, send back, resubmit, disposition, Ready]
    Workflow --> UoW[Unit of work: one transaction per business action]
    UoW --> Repos[Repositories: typed reads and appends over Drizzle]
    UoW --> Audit[Audit log: append and read only]
    Repos --> PG[(Postgres 16: rows, constraints, triggers, two roles)]
    Audit --> PG
    Routes --> Blob[Blob store interface: put, open, exists, verify]
    Blob --> FS[(Private directory, content-hash keyed)]
    PG -. artifact row references hash .-> FS
```

Rules that hold in any stack:

1. **Every business action is one transaction.** State change, projection update, audit event, notification row and idempotency record commit together or not at all.
2. **Authority is not in the store.** The store records who did what; it never decides whether they may. W0-05 policy runs before any repository call. Model output (QC) has no write path to workflow tables (W0-07).
3. **Two write disciplines.** Draft data (open draft version and its slots, notification retry columns, case projections) is mutable through named repository methods. Everything else is append-only and frozen by database triggers, not only by convention.
4. **Bytes and metadata are separate.** Postgres holds references and hashes; the blob store holds bytes. No document bytes in Postgres, in audit rows or in logs.
5. **Migrations are an operator step.** The process never migrates on start; it refuses to serve when the schema is behind.

D04 mapping: repositories are TypeScript modules over Drizzle's query builder, executed through `db.transaction()`; triggers and role grants live in SQL migrations; the blob store is a class over `node:fs/promises` and `node:crypto`; correlation IDs come from Fastify's `request.id` carried in an `AsyncLocalStorage`.

## Data model

### Conventions

| Convention | Rule |
|---|---|
| Primary keys | `uuid` v7 generated in the application (`crypto.randomUUID()` is v4; use a v7 helper in `rai-web/shared` so IDs sort by time), column name `id`. Never sequential integers in URLs. |
| Time | `timestamptz`, UTC in the database. Rendering in Asia/Bangkok is a presentation rule (D06, D12), never a storage rule. |
| Actor | `actor_subject_id text` (the W0-03 subject ID) plus `actor_role text` (the role the actor acted as; the dual-role fixture user acts as exactly one role per action). Display names are looked up, not stored on business rows. |
| Correlation | `correlation_id text NOT NULL` on every row a request creates (audit, notification, QC run, decision, disposition, idempotency). Same value as the W0-10 log line. |
| Enumerations | Postgres `text` with a `CHECK (col IN (...))` constraint, mirrored by a TypeScript union in `rai-web/shared`. Adding a value is a migration plus a shared-type change. |
| JSON | `jsonb` only for shapes this document names; each has a schema in `rai-web/shared` validated on write. No free-form blobs. |
| Text | `text` everywhere, UTF-8; Thai and mixed-script values are stored unchanged (W1-03 filename round-trip test). Length limits are application validation (W0-02 shapes), not `varchar(n)`. |
| Deletion | The application role has no `DELETE` on any business table (see [Immutability](#immutability)). Cleanup of drafts and orphan blobs is a named operator command, not a route. |

### Entity relationships

```mermaid
erDiagram
    CASE ||--o{ PACK_VERSION : "has versions"
    CASE ||--o| PACK_VERSION : "current_version_id"
    CASE ||--o| PACK_VERSION : "draft_version_id"
    PACK_VERSION ||--|{ ARTIFACT_SLOT : "nine slots"
    ARTIFACT_SLOT }o--o| ARTIFACT : "artifact_id"
    PACK_VERSION ||--o{ LANE_DECISION : "per lane"
    PACK_VERSION ||--o{ QC_RUN : "triggered on"
    QC_RUN ||--o{ QC_FINDING : "produces"
    QC_FINDING ||--o{ DISPOSITION_EVENT : "appends"
    PACK_VERSION ||--o{ NOTIFICATION : "about"
    PACK_VERSION }o--|| CONFIGURATION_REVISION : "frozen at submit"
    CASE ||--o{ AUDIT_EVENT : "target_case_id"
    PACK_VERSION o|--o{ AUDIT_EVENT : "target_version_id"
```

### `case`

One review case. Mutable columns are the inherited descriptive fields (owner and BU SPOC edit them on the draft), the desk-local fields, and the workflow-written projections.

| Column | Type | Written by | Notes |
|---|---|---|---|
| `id` | uuid PK | create | |
| `registry_id` | text UNIQUE | create | Desk-local human ID, `RAI-YYYY-NNNN`, allocated from a per-year sequence inside the create transaction. Not an external ID (L3). |
| `source_record_id` | text NOT NULL | owner / SPOC | `TPM-…`, `VRO-…` or the literal `Unknown` (L10). Never validated against an external system. |
| `use_case_name`, `business_unit`, `business_owner`, `technical_owner` | text NOT NULL | owner / SPOC | Inherited descriptive fields. W0-09 (W0-05 section 8 reconciliation): `business_unit` is the descriptive text of the W0-02 `businessUnit` body field and `business_owner` is written by the server as the display name of the subject in `owner_subject_id` at create and at every owner change; neither is ever read for access. |
| `use_case_group` | text NOT NULL | owner / SPOC | D11: value must exist in the current `use_case_groups` configuration revision at write time; checked in the application, not by FK (revisions are immutable and the list may change later). |
| `risk_tier` | text NULL | workflow (W5) | `high`, `medium`, `low` or NULL. Written only by the W5 risk proposal on submit; slice 1 never writes it. Never editable by owner or SPOC. |
| `privacy_status`, `security_status`, `rai_status`, `ai_readiness_status` | text NOT NULL | **workflow only** | Read-only projections; see [the projection rule](#desk-local-case-fields-and-the-four-status-projections). |
| `vendor_involved` | boolean NOT NULL | owner / SPOC | Desk-local (W0-04 fields). Drives the slot 3/4 default in W1-04. Never exported as a registry field. |
| `model_type` | text NOT NULL | owner / SPOC | Desk-local (W0-04 fields). `llm`, `classic_ml` or `other`. Drives the classic-ML metric-or-N/A rule in W4. Never exported. |
| `owner_subject_id` | text NOT NULL | create | Scope for the Owner role. The W0-02 `businessOwner` body field: the creator, or the owner named by a BU SPOC creating on an owner's behalf. Changes only through a W0-05-permitted action (`case.edit_draft` with the W0-05 edit-target check), which writes an audit event. |
| `business_unit_id` | text NOT NULL | create | Scope for the BU SPOC role. The W0-02 `businessUnitId` body field; a key from the fixture BU list (`CM`, `HR`; W0-03 section 7) in slice 1; the AD-group mapping arrives at W6/W8. |
| `desk_status` | text NOT NULL | workflow | `draft`, `in_review`, `ready`. Queue display value derived from the same transactions that write the projections. Never a lifecycle stage (L2). W0-09: the API `CaseStatus` is the W0-06 section 2.4 derivation (`draft`, `sent_back`, `in_review`, `awaiting_disposition`, `ready_for_launch`), computed from the rows; this column is its coarse stored mirror (`draft` ← draft or sent_back; `in_review` ← in_review or awaiting_disposition; `ready` ← ready_for_launch) for the queue index and is never returned as the status value. |
| `current_version_id` | uuid NULL FK | workflow | The latest **submitted** version; NULL until first submit. "Always have the latest" (R7). |
| `draft_version_id` | uuid NULL FK | workflow | The single open draft, or NULL. Uniqueness of the successor draft (D05) rests on this column plus the case row lock. |
| `row_version` | integer NOT NULL | every update | Optimistic-concurrency counter for draft-time edits on this case (case fields and draft slots); it is the W0-02 `caseRevision` / `draftRevision` and the W0-06 `ExpectedVersion.revision` (W0-09: one counter per case). Business actions use `current_version_id` instead. |
| `created_by`, `created_at`, `updated_at` | text, timestamptz | | |

Constraints: `CHECK (model_type IN ('llm','classic_ml','other'))`; `CHECK (desk_status IN ('draft','in_review','ready'))`; the four projection columns each `CHECK (... IN (...))` per the value table below; FKs to `pack_version` are `DEFERRABLE INITIALLY DEFERRED` because the version row references the case and the case references the version inside one transaction.

### `pack_version`

A draft becomes a submitted version in place: the row is mutable while `submitted_at IS NULL` and frozen once it is set. Corrections after submit create a new row (successor draft), never an update.

| Column | Type | Frozen at submit | Notes |
|---|---|---|---|
| `id` | uuid PK | | |
| `case_id` | uuid FK NOT NULL | | |
| `version_number` | integer NOT NULL | | 1, 2, 3…; `UNIQUE (case_id, version_number)`. |
| `parent_version_id` | uuid NULL FK | | The submitted version this draft corrects (NULL for v1). |
| `created_by`, `created_at` | | | Draft creation (owner / SPOC on create; the send-back transaction for successors). |
| `stage_context` | text NOT NULL | yes | D11: `idea`, `pre_build`, `pre_launch`. QC input only. |
| `checklist_template_version` | text NOT NULL | yes | L12. Recorded on the draft (W1-04) from the current configuration; frozen at submit. |
| `configuration_revision_id` | uuid FK NULL → NOT NULL at submit | yes | The one published configuration revision in force at submit (QC rules, risk rubric, SLA values, calendar). Historical packs stay bound to it (data contract). |
| `frozen_configuration` | jsonb NULL → NOT NULL at submit | yes | `{kind: revision_id}` for every configuration kind in force at submit; see `configuration_revision` below for why one FK is not enough. |
| `lane_mapping_version` | text NULL → NOT NULL at submit | yes | D02: the identifier of the versioned constant in code (`lane-mapping/v1`, the W0-06 section 3 `LANE_MAPPING_V1.version`) and, in `lane_mapping jsonb`, its content `{ai_coe:[1,5], dpo:[2,3,4,5], it_security:[5,6,7,8]}`, so a restored backup is self-describing. Not Admin configuration. |
| `submitted_by`, `submitted_role`, `submitted_at` | text, text, timestamptz NULL | set once | The submit transaction sets all three. `submitted_at` non-NULL means frozen (the W0-06 `state = submitted`). The SLA clock for all three lanes starts here (D06); lane open time is not stored separately. |
| `ready_at` | timestamptz NULL | set once | W0-09: added for W0-06 (sections 4.9, 6 and 9.2): the Ready transition sets it once on the current version in the same transaction as `case.ready_for_launch`; the frozen-row trigger permits exactly that one change on a submitted row (`ready_at` from NULL to a value, every other column unchanged). The W0-06 `ready_version_id` is `case.current_version_id` when `desk_status = 'ready'`. |
| `manifest_hash` | text NULL → NOT NULL at submit | yes | SHA-256 over the canonical JSON of the nine slot rows (slot, state, reason, artifact hash, filename, media type, size). Lets A07 tests and the W7-00 restore check prove a version unchanged without diffing rows. |
| `submit_correlation_id` | text NULL | yes | Same value as the submit audit event. |

Lane state is **derived**, not stored: a lane on the current version is `pending` with no `lane_decision` row, `approved` when the row's `decision` is `approve` and `sent_back` when it is `send_back` (the W0-06 2.3 and W0-02 `LaneProjectionStatus` words). This keeps one record per decision (L8); the case projections are the only denormalisation and they are workflow-written.

### `artifact_slot`

Nine rows per version, created with the draft (state `missing` until the owner acts), mutable while the parent version is a draft, frozen with it.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `version_id` | uuid FK NOT NULL | `UNIQUE (version_id, slot)` |
| `slot` | smallint NOT NULL | 1-9, `CHECK (slot BETWEEN 1 AND 9)` |
| `state` | text NOT NULL | `attached`, `not_yet`, `not_applicable`, `missing` (source spec: four distinct facts) |
| `reason` | text NULL | Required when `state = 'not_applicable'`: `CHECK (state <> 'not_applicable' OR reason IS NOT NULL)`. The slot 3/4 non-vendor default writes a locale key here (D12), for example `slot.na.reason.non_vendor_default`, so the reason stays visible and translatable. |
| `artifact_id` | uuid NULL FK | Required when `state = 'attached'`: `CHECK (state <> 'attached' OR artifact_id IS NOT NULL)`; NULL otherwise. Must reference an `artifact` row whose `case_id` is the version's case (see the case binding under [`artifact`](#artifact)). |
| `updated_by`, `updated_at` | | Last draft edit. |

Copying to a successor draft: the send-back transaction inserts nine new rows for version N+1 with the same `state`, `reason` and `artifact_id` as version N. Version N's rows are untouched. Replacing a document in the draft points the draft's row at a new `artifact` row; the old `artifact` row and blob remain because version N references them.

### `artifact`

Metadata for one accepted upload. Immutable once inserted. Several slot rows (across versions of the same case) may reference one artifact row, never a slot row of another case (the case binding below); several artifact rows may reference one blob (same bytes uploaded twice keep separate metadata: different filename, uploader or time).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | The reference used in URLs and slot rows. The hash is never a URL. |
| `content_hash` | text NOT NULL | Lowercase hex SHA-256 of the bytes, computed while streaming the upload, before the blob is committed. Index, not unique. |
| `size_bytes` | bigint NOT NULL | Counted while streaming; must equal the blob's size on disk. |
| `filename` | text NOT NULL | The client filename after W0-08 normalisation (Unicode NFC, path separators and control characters removed, length limit). Thai preserved (W1-03). |
| `media_type` | text NOT NULL | The **sniffed** type from W0-08, never the client's `Content-Type`. |
| `uploaded_by`, `uploaded_role` | text NOT NULL | |
| `uploaded_at` | timestamptz NOT NULL | |
| `case_id` | uuid FK NOT NULL | The case the upload was authorised against. Download authorization is checked against this case's scope; an artifact cannot be reached through another case's URL. **Case binding:** `VersionWriteRepository.updateDraftSlot` loads the artifact row inside the draft transaction and rejects an `artifact_id` whose `case_id` differs from the version's case with `ArtifactCaseMismatch` (422 `invalid_input`, field `artifactId`), so a slot can never point at another case's upload, which would otherwise be un-downloadable under the slot's case and would leak the other case's filename and size through the slot listing. W1-04 tests this. W1-04 may additionally back it in the database with `UNIQUE (id, case_id)` here and a denormalised `artifact_slot.case_id` under a composite FK `(artifact_id, case_id) REFERENCES artifact (id, case_id)`; the repository check is required either way. |
| `correlation_id` | text NOT NULL | |
| `bytes_state` | text NOT NULL DEFAULT `'present'` | `present` or `destroyed`. Reserved for the D08 deletion options; slice 1 never writes `destroyed`. |

### `lane_decision`

Append-only. One row per (version, lane): a lane decides a submitted version once; anything after that happens on a successor version (D05 full re-review). `UNIQUE (version_id, lane)` is the store's constraint; W0-06 confirms it as the transition rule.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `version_id` | uuid FK NOT NULL | Must be a submitted version (application check under the case lock). |
| `lane` | text NOT NULL | `ai_coe`, `dpo`, `it_security` |
| `decision` | text NOT NULL | `approve`, `send_back` |
| `actor_subject_id`, `actor_role` | text NOT NULL | W0-05 forbids Admin, and forbids an actor who is owner or BU SPOC on the case (D05). The store records; it does not check. |
| `feedback` | jsonb NULL | Required for `send_back`: `[{slot: 1-9, artifact_id?: uuid, message: text}]`, at least one entry naming a slot (A09). `CHECK (decision <> 'send_back' OR feedback IS NOT NULL)`. |
| `observed_qc_run_id` | uuid FK NULL | The approve-attempt QC run the reviewer saw before deciding (the W0-06 4.4 `qc_run_id`; W0-07). Required for `approve` (W0-06: `invalid_input` `lane_qc_not_run` without one); NULL permitted for `send_back`. |
| `decided_at`, `correlation_id`, `idempotency_key_id` | | |

### `qc_run` and `qc_finding`

Written by the workflow on behalf of the QC boundary (W0-07): the QC substitute returns a typed result and the workflow transaction inserts it. QC itself has no database credential.

`qc_run`: `id`, `version_id` FK, `trigger` (`upload`, `submit`, `approve_attempt`), `slot` (smallint NULL; set for `upload`), `lane` (text NULL; set for `approve_attempt`), `engine_id` (text; `substitute-scripted` in slice 1), `rule_revision` (text; the QC rules revision from the frozen configuration), `status` (`completed`, `unavailable`), `requested_at`, `completed_at`, `correlation_id`. Immutable once `status` is set: the run row is inserted once, with its final status, and is never updated. W0-09 (W0-06 owns the order): the run happens **after** the triggering action's transaction has committed, in its own transaction under the case row lock (W0-06 4.3 "the submit response does not wait for QC", 9.1; W0-07 3.4), with the trigger's `correlation_id`; the earlier "same transaction as the trigger" wording and the QC statements in the Submit and Decide rows below are withdrawn. The approve-attempt run is a separate call before the decision (the W0-06 4.4 lane-QC run endpoint), and the decision row references it through `observed_qc_run_id`.

`qc_finding`: `id`, `run_id` FK, `version_id` FK (denormalised for the Ready predicate query), `slot` (smallint NULL; NULL for pack-level findings), `kind` (`defect`, `unavailable`), `rule_id`, `rule_revision`, `severity` (`high`, `medium`, `low`, `info`), `owning_lane` (`ai_coe`, `dpo`, `it_security`; assigned by the W0-06 rule; NOT NULL because an `unavailable` finding also carries one), `evidence` jsonb (`{artifact_id?, page?, locator?, excerpt_hash?}`: references only, never document text; an excerpt is at most a hash so that logs and audit stay clean), `metric`, `denominator`, `threshold` (numeric NULL, for the accuracy rule), `message_key` text NOT NULL (D12 locale key) and `message_params` jsonb, `created_at`. Append-only; no update or delete.

### `disposition_event`

Append-only. The effective disposition of a finding is the **latest** event per finding; nothing is ever overwritten (data contract, D05).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `finding_id` | uuid FK NOT NULL | |
| `kind` | text NOT NULL | `fixed_proposed` (owner or SPOC), `fixed` (owning lane directly, no proposal; W0-06 4.8, added at W0-09), `fixed_confirmed` (owning lane), `waived` (owning lane), `not_applicable` (owning lane). Who may write which is W0-05; the store constrains only the vocabulary. |
| `reason` | text NULL | `CHECK (kind NOT IN ('waived','not_applicable') OR reason IS NOT NULL)` (A09). |
| `evidence_ref` | jsonb NULL | Reference to an artifact or slot, never bytes. |
| `actor_subject_id`, `actor_role`, `created_at`, `correlation_id`, `idempotency_key_id` | | |

A finding counts as **dispositioned** for the Ready predicate when its latest event is `fixed`, `fixed_confirmed`, `waived` or `not_applicable`. `fixed_proposed` does not count (D05: the owning lane confirms).

### `notification`

One row per (event, version, lane, recipient), the D06 dedup identity: `UNIQUE (event, version_id, lane, recipient)`. `lane` is the lane the event belongs to: the opened lane for `lane_open` and the **deciding** lane for `send_back` (D06 includes the lane in the dedup identity, so two lanes sending back the same version to the same owner are two rows, never one collision; a retry of the same lane's send-back is the same row). `lane` is stored as `'-'` only for the two events that have no lane, `ready` and `sla_breach_digest`, so the unique index holds. Columns: `id`, `event` (`lane_open`, `send_back`, `ready`, `sla_breach_digest`), `version_id` FK NULL (NULL for the digest), `case_id` FK NULL, `lane`, `recipient` (email address; in slice 1 only fixture addresses and the W0-08 synthetic operator recipient), `deep_link_path` (path only, never a token that grants access; the link still requires sign-in and scope), `template_key` (D12 locale key), `template_params` jsonb, `status` (`queued`, `sent`, `failed`), `attempts` smallint, `next_attempt_at`, `last_error_code`, `created_at`, `correlation_id`. The row is inserted in the committing business transaction (so no mail exists for a rolled-back transition, A05); the mail sink updates only `status`, `attempts`, `next_attempt_at`, `last_error_code` (W3-04). No other column is updatable.

### `configuration_revision`

L12 configuration, versioned and immutable once published. Slice 1 seeds published revisions (W1-00); W6 adds drafting and publishing through the UI.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `kind` | text NOT NULL | `checklist_templates`, `qc_rules`, `sla`, `calendar`, `operator_recipients`, `use_case_groups`, `risk_rubric` (W5), `group_role_mapping` (W6/W8). One kind per revision keeps activation independent. |
| `revision_number` | integer NOT NULL | `UNIQUE (kind, revision_number)` |
| `body` | jsonb NOT NULL | Schema per kind in `rai-web/shared`. `sla` holds `{dpo: 3, ai_coe: 5, it_security: 5}` working days (D01); `operator_recipients` holds addresses (D06); `calendar` holds `{timezone: "Asia/Bangkok", holidays: ["YYYY-MM-DD", …]}`. |
| `published_by`, `published_at` | text, timestamptz NOT NULL | Slice 1 has no unpublished revisions; the columns are NOT NULL until W6 introduces drafts by a migration that adds a nullable `draft_of` column, never by relaxing these. |
| `activation_rule` | text NOT NULL | `after_publish` in slice 1 (W1-00 provisional rule: applies to submissions after `published_at`); W6 may add values by migration. |
| `supersedes_id` | uuid FK NULL | Previous revision of the same kind. |

`pack_version.configuration_revision_id` points at **one** revision, so a version needs one row that carries every kind it froze. To keep one FK and independent kinds, the submit transaction resolves the current revision of each kind and records them in `pack_version.frozen_configuration jsonb` as `{kind: revision_id}`; `configuration_revision_id` holds the `qc_rules` revision (the one most often queried) and the jsonb holds all of them. Both are frozen columns.

### `audit_event`

See [Audit log](#audit-log) for the rules. Columns:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `seq` | bigint GENERATED ALWAYS AS IDENTITY | Total order for reconstruction (A11); never exposed in URLs. |
| `occurred_at` | timestamptz NOT NULL | |
| `actor_subject_id`, `actor_role` | text NOT NULL | `system` / `system` for the breach digest and mail retry outcomes. |
| `action` | text NOT NULL | W0-09: the workflow names are W0-06 section 9.4's, verbatim: `case.created`, `draft.saved` (case-field and slot edits, including the W0-05 scope-field change with old and new values), `version.submitted`, `version.resubmitted`, `lane.opened`, `lane.approved`, `lane.sent_back`, `draft.successor_created`, `disposition.proposed`, `disposition.confirmed`, `disposition.recorded`, `case.ready_for_launch`, `qc.run_recorded`. Non-workflow names this spec adds: `artifact.uploaded`, `artifact.downloaded`, `configuration.published`, `notification.queued`, `notification.failed`, `audit.read`; identity names from W0-03 section 10: `identity.signed_in`, `identity.sign_in_refused`, `identity.signed_out`. The earlier `case.edited`, `finding.recorded`, `qc.unavailable` and `case.ready` are withdrawn. New actions are added by the ticket that introduces them, in the shared union. |
| `target_case_id` | uuid NULL | |
| `target_version_id` | uuid NULL | |
| `target_ref` | jsonb NULL | Other references: `{slot, artifact_id, finding_id, disposition_id, decision_id, configuration_revision_id, notification_id}`. IDs only. |
| `before_ref`, `after_ref` | jsonb NULL | State references, for example `{current_version_id, desk_status, privacy_status…}` before and after. Never document bytes, filenames of real people, feedback text or finding text: those are read from their own rows by ID. |
| `correlation_id` | text NOT NULL | |

### `idempotency_key`

| Column | Type | Notes |
|---|---|---|
| `actor_subject_id` | text | PK part 1 |
| `key` | text | PK part 2. Client-generated UUID, supplied in the `Idempotency-Key` header (W0-02 section 7, W0-06 5.3; confirmed at W0-09). |
| `action` | text NOT NULL | The route or service name. |
| `target_case_id` | uuid NOT NULL | |
| `request_digest` | text NOT NULL | SHA-256 of the canonical request body plus the expected version. |
| `response_status` | smallint NOT NULL | |
| `response_body` | jsonb NOT NULL | The exact success response, replayed verbatim (A07, ADR-0003 "replay returns the original success response"). |
| `created_at` | timestamptz NOT NULL | Rows older than `IDEMPOTENCY_TTL_HOURS` (default 72) are removed by the operator cleanup command, not by a request. |

Sessions (W0-03) and the W3-05 working-day calculation have no tables here; the calendar is configuration and the SLA due date is computed from `submitted_at`.

## Desk-local Case fields and the four status projections

Register row **W0-04 fields** (Ta, 2026-09-21), implemented as written:

- `vendor_involved` (boolean) and `model_type` (`llm` / `classic_ml` / `other`) are **desk-local**. They live on `case`, are edited by owner and BU SPOC through the W1-02 edit shape, and are never included in any export, link or field list that presents itself as registry data. The `registry_id`/`source_record_id` pair is the only bridge to the register (L3, L10).
- `privacy_status`, `security_status`, `rai_status`, `ai_readiness_status` are **read-only projections written only by the workflow**. They carry inherited registry *names* with desk-defined *values*; they are never exported, never a second record of a decision (the `lane_decision` row is the record) and never a second record of Ready (the Ready transition's audit event and `desk_status = 'ready'` are the record, L8).

| Column | Values | Written to | By which transaction |
|---|---|---|---|
| `privacy_status` | `pending`, `approved`, `sent_back` | `approved` / `sent_back` | DPO lane decision (W2-02) |
| `security_status` | same | same | IT/Security lane decision (W2-02) |
| `rai_status` | same | same | AI/COE lane decision (W2-02) |
| all three | `pending` | reset | Submit and resubmit (W1-05, W2-04): every submission reopens all lanes (D05) |
| `ai_readiness_status` | `not_ready`, `ready` | `ready` | Ready predicate (W2-06), in the same transaction as the `case.ready_for_launch` audit event |
| `ai_readiness_status` | `not_ready` | reset | Resubmit. W0-09: W0-06 section 4.12 records that no mutating event, resubmit included, is accepted on a Ready case in slice 1, so this reset is unreachable in slice 1 and stays as the rule for a later reopen decision (W0-06 section 11) |

Enforcement, three layers, all required:

1. **Shape.** The W0-02 case create/edit request types contain `vendor_involved` and `model_type`; the four projections and `risk_tier` are not in any request type. A request that includes them fails JSON-schema validation with `invalid_input` (422) before any repository call. W1-02 tests this.
2. **Repository.** `CaseRepository.updateDraftFields(caseId, fields, expectedRowVersion)` accepts a `Pick` of the editable columns only; the projection columns are written by `CaseRepository.applyLaneProjection(tx, caseId, lane, value)` and `applyReadiness(tx, caseId, value)`, which exist only inside the workflow module and take a transaction handle, so they cannot be called from a route.
3. **Database.** A `BEFORE UPDATE` trigger on `case` raises `rai.projection_write_forbidden` when any of the four columns (or `risk_tier`) changes unless the transaction has executed `SET LOCAL rai.workflow_write = 'on'`, which only `withWorkflowTransaction` does. An integration test runs an `UPDATE case SET privacy_status = 'approved'` as the application role outside that setting and expects the error (W1-02 "a write the rule forbids is rejected").

## Immutability

Rule (W0 contract): a submitted version and its artifact references are never updated; corrections create a new version; findings are never overwritten; dispositions append.

| Table | Insert | Update | Delete | Mechanism |
|---|---|---|---|---|
| `pack_version` | app | only while `submitted_at IS NULL`; the submit transaction is the last update, except `ready_at` NULL → value once (Ready) | never | trigger `pack_version_frozen`: `IF OLD.submitted_at IS NOT NULL THEN RAISE EXCEPTION 'rai.frozen_version'` unless the only changed column is `ready_at` from NULL to a value (W0-06 9.2, W0-09); no `DELETE` grant |
| `artifact_slot` | app (draft creation, successor copy) | only while the parent version is a draft | never | trigger `artifact_slot_frozen` joins the parent and raises when `submitted_at IS NOT NULL`; no `DELETE` grant |
| `artifact` | app | never (`bytes_state` is the single D08 exception, gated like a projection) | never | trigger `artifact_frozen` raises on any change other than `bytes_state` under `rai.retention_write = 'on'`; no `DELETE` grant |
| `lane_decision`, `qc_run`, `qc_finding`, `disposition_event` | app | never | never | triggers raise on UPDATE; no `UPDATE`/`DELETE` grant |
| `audit_event` | app | never | never | trigger raises on UPDATE and DELETE; no `UPDATE`/`DELETE` grant; the DAL has no method |
| `configuration_revision` | app (seed, W6 publish) | never once published | never | trigger raises on UPDATE where `OLD.published_at IS NOT NULL`; no `DELETE` grant |
| `notification` | app | only the four delivery columns | never | trigger raises if any other column changes |
| `case` | app | editable columns freely; projections gated | never | trigger above; no `DELETE` grant |
| `idempotency_key` | app | never | operator cleanup only | no `UPDATE` grant; `DELETE` granted to the operator role only |

Database roles (created by the compose init script locally and by the D10 runbook in production):

| Role | Used by | Grants |
|---|---|---|
| `rai_owner` | migrations (`DATABASE_MIGRATE_URL`) | owns the schema; DDL; still subject to the triggers, so a migration that tries to rewrite a frozen row fails |
| `rai_app` | the Fastify process (`DATABASE_URL`) | `SELECT`, `INSERT` on all tables; `UPDATE` only on `case`, `pack_version`, `artifact_slot`, `artifact`, `notification`; no `DELETE` anywhere; no DDL |
| `rai_operator` | operator commands (`db:cleanup`, `store:verify`, `store:cleanup`, `reset` locally) | `rai_app` plus `DELETE` on `idempotency_key`, on draft `pack_version`/`artifact_slot` rows through the cleanup function, and `TRUNCATE` only when `NODE_ENV <> 'production'` (enforced in the command, not the grant) |

Both the trigger and the grant are required. The trigger protects against a privileged connection (a migration, an operator session); the grant protects against an application bug. The A11 test attempts `UPDATE` and `DELETE` on `audit_event` as `rai_app` and as `rai_owner` and expects both to fail (permission error and trigger error respectively).

What "update" means for a draft: the owner edits fields on the `case` row and the draft's slot rows. Those are the only mutable business rows and only until submit. The W1-05 test "a second write to that version's artifact ref is rejected" is an `UPDATE artifact_slot SET artifact_id = … WHERE version_id = <submitted>` expecting `rai.frozen_version`.

## Artifact store

### Interface

```ts
// rai-web/server/src/artifacts/blob-store.ts (path per W0-02)
export interface BlobStore {
  /** Streams bytes to a private temp location, hashes while writing, then commits under the hash. */
  put(input: NodeJS.ReadableStream, opts: { maxBytes: number }): Promise<PutResult>;
  /** Opens a read stream for the bytes. Callers have already passed authorization. */
  open(hash: ContentHash): Promise<NodeJS.ReadableStream>;
  exists(hash: ContentHash): Promise<boolean>;
  /** Re-hashes the stored bytes and compares. Used by store:verify and W7-00. */
  verify(hash: ContentHash): Promise<{ ok: true } | { ok: false; reason: 'missing' | 'hash_mismatch' | 'size_mismatch' }>;
  /** Removes an uncommitted temp file after a failed upload. Idempotent. */
  discard(tempRef: TempRef): Promise<void>;
}
export type ContentHash = string & { readonly brand: 'sha256-hex' };
export type PutResult =
  | { ok: true; hash: ContentHash; sizeBytes: number; deduplicated: boolean }
  | { ok: false; reason: 'too_large' };
```

The store knows nothing about cases, slots, roles or media types. Sniffing (W0-08) happens on the first bytes of the same stream in the upload route, before `put` is allowed to commit: the route pipes the request into a `PassThrough` that feeds the sniffer and the store; if the sniffer rejects, the route calls `discard` and answers `unsafe_upload`. `maxBytes` comes from the W0-08 limit in configuration.

### Layout and write path

- Root: `BLOB_DIR` (absolute path; local default `./.local/blobs` per W0-02 section 5, gitignored; a Docker volume or host directory in CI). Created with mode `0700`; files `0600`. Nothing under it is ever served statically; Fastify has no `@fastify/static` mount there.
- Key: `sha256/<h[0:2]>/<h[2:4]>/<h>` where `h` is the lowercase hex SHA-256 of the bytes. Two-level sharding keeps directories small; the full hash is the filename.
- Write: stream to `tmp/<uuid>` under `BLOB_DIR`, hashing with `crypto.createHash('sha256')` and counting bytes; on end, `fsync` the file, `rename` to the key path (atomic on the same filesystem), `fsync` the directory. If the key already exists, the temp file is removed and `deduplicated: true` is returned after confirming the existing file's size equals the counted size (a size mismatch is an integrity error, not a silent dedupe).
- No mutation: there is no `delete` or `overwrite` method. The D08 options add a retention command outside the request path; slice 1 ships without it.

### Upload and download flow

Upload (W1-03): authorize (`case.edit` scope, W0-05) → stream with size cap → sniff (W0-08) → `put` → insert `artifact` row (`content_hash`, `size_bytes`, sniffed `media_type`, normalised `filename`, uploader, time, `case_id`, correlation) → audit `artifact.uploaded` → commit. The blob is committed before the row; an orphan blob after a failed transaction is harmless and collected later (see D08 options). A row is never inserted for bytes that were not committed.

Download (W1-03): the W0-02 7.4 route `GET /api/artifacts/{artifactId}` (keyed by the artifact id alone; W0-09 replaced the earlier "inside a case URL" wording) → resolve `artifact.case_id` and authorize under the case-view row (W0-05 "Downloads and deep links") → `open(hash)` → stream with `Content-Type` from the row, `Content-Disposition: attachment; filename="<ascii-fallback>"; filename*=UTF-8''<percent-encoded original>` (RFC 6266/5987, which is what makes a Thai filename round-trip), `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, `Cache-Control: no-store`, `Content-Length` from the row → audit `artifact.downloaded` (the one audit event written outside a state change; it is still one insert in its own transaction with the request correlation ID). A request without a session gets 401; out of scope gets 403; an unresolvable artifact id is 403 for an owner or BU SPOC and 404 `not_found` only for an `all_cases` holder (W0-05 section 4, recorded at W0 exit).

Never exposed: the hash, the filesystem path, a pre-signed or token URL. The deep link in a mail (W3-03) is a case path, not an artifact path.

## Transactions and idempotency

All business actions run through one helper:

```ts
withWorkflowTransaction(ctx, caseId, async (tx) => {
  await tx.execute(sql`SET LOCAL rai.workflow_write = 'on'`);
  const c = await tx.lockCase(caseId);            // SELECT … FROM "case" WHERE id = $1 FOR UPDATE
  const replay = await tx.idempotency.find(ctx.actor, ctx.idempotencyKey);
  if (replay) return replay.matches(ctx) ? replay.response : invalidInput('idempotency_key_reused');
  if (ctx.expectedVersionId && c.current_version_id !== ctx.expectedVersionId) return staleVersion(c.current_version_id);
  /* action-specific statements */
  await tx.audit.append({...ctx, action, before, after});
  await tx.idempotency.store(ctx, response);
  return response;
});
```

Isolation is `READ COMMITTED` (the Postgres default); correctness comes from the per-case row lock, which serialises every business action on one case, including concurrent send-backs, and from the unique constraints as a second line. Actions on different cases do not block each other. Lock wait is bounded by `SET LOCAL lock_timeout = '5s'`; a timeout surfaces as an internal error with the correlation ID, never as a partial write.

| Action (ticket) | Atomic statements, in order, after lock + idempotency + expected-version checks | Idempotency key | Expected version |
|---|---|---|---|
| Create case (W1-02) | insert `case` (allocate `registry_id`), insert draft `pack_version` v1 with nine `missing` slots (3 and 4 `not_applicable` with the default reason when `vendor_involved` is false), set `draft_version_id`, audit `case.created` | yes | none |
| Edit case / save draft (W1-02, W1-04) | update editable `case` columns or draft slot rows with `row_version` check, audit `draft.saved` (W0-06 4.2; changed-field list as references) | no (W0-06 5.3: the revision check makes a duplicate save fail closed) | `row_version` (409 `stale_version` `revision_changed`; `version_superseded` when the named draft is no longer the open draft) |
| Upload (W1-03) | blob committed first (outside the transaction, see above); then insert `artifact`, audit `artifact.uploaded` | no (idempotent by content hash, W0-06 5.3) | none |
| **Submit** (W1-05, W2-01) | resolve current configuration revisions and the lane-mapping constant; update draft `pack_version`: `submitted_*`, frozen columns, `manifest_hash`; update `case`: `current_version_id = draft`, `draft_version_id = NULL`, `desk_status = 'in_review'`, three projections `pending`; insert three `notification` rows (`lane_open`, one per lane); audit `version.submitted` then `lane.opened` × 3 (W0-06 4.3). Pack QC runs after commit in its own transaction (`qc_run` paragraph above) | yes | `draft_version_id` must equal the submitted draft; `row_version` for the draft |
| **Decide** approve / send back (W2-02) | (approve-attempt QC ran earlier as its own call and its `qc_run` row exists; the request names it) insert `lane_decision` with `observed_qc_run_id`; update the lane's projection; for `send_back`: if `draft_version_id IS NULL` insert successor `pack_version` N+1 (`parent_version_id = N`, `stage_context`, `checklist_template_version` copied) and nine slot rows copied from N, set `draft_version_id`, audit `draft.successor_created`; insert `notification` (`send_back` to owner, `lane` = the deciding lane); audit `lane.approved` / `lane.sent_back`; for approve, evaluate the Ready predicate and apply the Ready row below in the same transaction when it holds (W0-06 4.4, 4.9) | yes | `current_version_id` |
| **Send back, concurrent** (W2-03) | the second send-back waits on the case lock, then finds `draft_version_id` set and appends only its own decision and its own `send_back` notification (a distinct `lane` in the dedup key, so the second row cannot collide with the first lane's row; a retry of either lane replays through its idempotency key and inserts nothing); exactly one successor exists (`UNIQUE (case_id, version_number)` would also refuse a second N+1) | yes | `current_version_id` |
| **Resubmit** (W2-04) | same as submit on the successor draft; additionally `ai_readiness_status = 'not_ready'`; audit `version.resubmitted` with `before_ref.current_version_id = N` | yes | as submit |
| Disposition (W2-05) | insert `disposition_event`; audit `disposition.recorded` (`disposition.proposed` for `fixed_proposed`, `disposition.confirmed` for `fixed_confirmed`; W0-06 4.7); evaluate the Ready predicate and apply the Ready row when it holds | yes | `current_version_id` (a finding on a superseded version cannot be dispositioned: W0-06 5.2 `version_superseded`, confirmed) |
| **Ready** (W2-06; applied inside the approve or disposition transaction, never a request of its own) | recheck under the lock: three `lane_decision` rows with `decision = 'approve'` on `current_version_id`, one per lane, and zero `qc_finding` rows on that version whose latest `disposition_event` is absent or `fixed_proposed`; if either fails, write nothing beyond the triggering event; else update `pack_version.ready_at`, update `case`: `ai_readiness_status = 'ready'`, `desk_status = 'ready'`; insert `notification` (`ready`); audit `case.ready_for_launch` with `triggered_by` = the triggering event | n/a (the triggering event's key) | `current_version_id` |
| Publish configuration (W1-00 seed, W6) | insert `configuration_revision` with `revision_number = max + 1` for the kind (under a per-kind advisory lock); audit `configuration.published` | yes | none |
| Mail attempt (W3-04) | update the four delivery columns; audit `notification.failed` on the final failure only | n/a (dedup key is the row identity) | none |

Ready is evaluated **only** inside this transaction, never from a cached count and never from the projections. The predicate query is the one in [Interfaces](#interfaces) so that W2-06 and the W2-08 exit evidence read the same SQL.

Idempotency-key rules: the key is scoped to the actor; a replay with the same digest returns the stored response and writes nothing (not even an audit event; the original already carries the correlation ID, and the replay is logged by W0-10 with its own ID and a reference to the original); a replay with a different digest is `invalid_input` (`error.invalid_input.idempotency_key_reused`, W0-06 8.5); a key is stored only on success, so a failed action can be retried with the same key. Because the key check happens under the case lock, two concurrent requests with the same key cannot both apply. Keys are required on create, submit, resubmit, approve, send back and disposition and not used on save draft or upload (W0-06 5.3); rows expire after `IDEMPOTENCY_TTL_HOURS` (72 by default), which W0-06 5.3 now cites.

## Restart proof

W1 exit evidence (BUILD_PLAN, W1-05, W1-INT): the same case reopens after a process restart.

- Postgres data directory is a named Docker volume (`rai_pgdata_<project>`) in `docker-compose.yml`; `BLOB_DIR` is a host path, not `tmpfs`. `docker compose down` without `-v` keeps both; `-v` is the documented reset.
- The Fastify process holds no state that a request depends on: no in-memory case cache, no in-process idempotency map, no session-bound draft. Sessions (W0-03 section 6.3) live in Postgres, so a restart never loses a committed row or a signed-in session.
- Integration recipe (`rai-web/tests/integration/w1-05-restart.test.ts`, the W0-02 section 1 naming): start the server against the ticket's Postgres → create, attach, submit through the API → record `registry_id`, `current_version_id`, `manifest_hash` and the artifact hash → `SIGTERM` the server process and wait for exit → start a new process on the same `DATABASE_URL` and `BLOB_DIR` → read the case, version, slots and download the artifact → assert equality of every recorded value and that the downloaded bytes hash to the stored hash. The Playwright journey in W1-INT repeats the same through the UI.

Graceful shutdown: on `SIGTERM` the server stops accepting connections, waits up to 10 s for in-flight transactions, then exits; a transaction cut short by a hard kill is rolled back by Postgres, which is why every action is one transaction and why the blob is committed before its row (an orphan blob is safe; a row without a blob is not).

## Audit log

Rules from the W0 contract, each with its mechanism and test:

| Rule | Mechanism | Test |
|---|---|---|
| Append-only; no update or delete path in the data-access layer | `AuditLog` exposes `append(tx, event)` and `read(query)` only; `audit_event` triggers raise on UPDATE and DELETE; `rai_app` has no UPDATE/DELETE grant | W1-00: the module exports no other method (type-level test plus a runtime `Object.keys` assertion); W2-08 / A11: raw UPDATE and DELETE as `rai_app` and as `rai_owner` fail |
| Written in the same transaction as the state change | `append` takes the transaction handle; there is no `append` without one; `withWorkflowTransaction` refuses to commit if the action returned without an audit event (`ctx.auditWritten` flag checked before commit) | W1-05, W2-02 to W2-06: a forced failure after the state change leaves no audit row and no state change |
| Carries the request correlation ID | `correlation_id NOT NULL`; value from `AsyncLocalStorage` seeded by Fastify `request.id` (W0-10 format) | W1-05, W3-07: the audit row, the log line and the notification row share one value |
| Fields are references, never document bytes | `before_ref`, `after_ref`, `target_ref` are validated against a shared JSON schema that permits only IDs, enum values and numbers; strings longer than 64 characters are rejected at `append` | W1-00: `append` with a text excerpt is rejected |
| Readable only by Admin and the D06 operator audience under the same server-side check as everything else | One read route; policy row `audit.read` in the W0-05 matrix decides; the operator audience has no seventh role (D06), and W0-05 section 8 records Admin as the slice-1 audience for `audit.read` and `operator.view`; the read itself writes `audit.read` | W3-07 negatives: every non-Admin fixture user gets 403 on the audit route |
| Full journey reconstructable from the audit trail alone (A11) | Every transaction above writes exactly the events named; `seq` orders them; `before_ref`/`after_ref` carry the version and status references | W2-08: a test replays the audit rows for the fixture case and rebuilds the sequence v1 → send-back → v2 → three approvals → dispositions → Ready without reading any other table |

Retention of audit rows differs from business data; see the D08 options.

## Schema evolution

- **Tooling.** Drizzle Kit generates SQL migrations from the Drizzle schema (`npm run migrate:generate`), committed as `NNNN_<slug>.sql` plus the journal under `rai-web/server/drizzle/` (W0-02 section 1). Triggers, grants and functions are hand-written SQL in the same migration files; Drizzle's schema file describes tables and indexes only. The `drizzle-kit push` command is forbidden (it diffs and mutates the live schema).
- **Explicit step.** `npm run migrate` (W0-02 section 3.3) runs pending migrations with `DATABASE_MIGRATE_URL` as `rai_owner`, inside a transaction per file, recording each in Drizzle's migrations table. The server never calls the migrator. On start the server compares the highest applied migration with the version it was built for; if behind, `GET /readyz` (W0-10 section 5) reports `store.migrations: pending` and the process refuses to serve any other route (fails closed). If ahead by an additive migration, it serves (that is the rollback expectation for additive migrations).
- **Forward-only.** No down migrations are written or run. Each migration file begins with a header:

  ```sql
  -- migration: 0007_add_finding_severity_index
  -- ticket: W2-05
  -- rewrites frozen rows: no
  -- rollback expectation: additive; previous release runs unchanged against this schema
  ```

  `rollback expectation` is one of `additive` (previous release still runs), `restore-required` (rollback means restoring the pre-migration backup and redeploying the previous release; the operator runbook at W7-00/W8 names the backup), or `copy-forward` (a reshaping that created a new table or column, copied data into it and left the original in place; the previous release still reads the original).
- **Never rewrite immutable rows.** No migration issues `UPDATE` or `DELETE` on `pack_version` (submitted), `artifact_slot` (frozen), `artifact`, `lane_decision`, `qc_run`, `qc_finding`, `disposition_event`, `audit_event` or published `configuration_revision`. Adding a nullable column or an index is allowed (no row changes). Backfilling a new column on frozen rows is not; the value is derived at read time or stored in a new side table keyed by the frozen row's ID. Because migrations run as `rai_owner` and the triggers apply to every role, a migration that tries to rewrite a frozen row fails at apply time; this is the enforcement, and the review checklist is the second line.
- **Tests, two targets, both in CI from W1-12.**
  1. *Fixture store:* fresh database → all migrations → load W1-09 fixtures → run the fixture journey to produce frozen rows → compute a digest of every frozen table (ordered rows, all columns) → apply the migrations under test (in a PR that adds one, the digest is taken at the previous migration) → recompute → assert equal, and assert `store:verify` passes.
  2. *Restored backup:* `pg_dump --format=custom` of the fixture database at the previous migration is committed as a CI artifact of the previous main build (not to Git) → `pg_restore` into a fresh database → migrate → same digest assertion → `store:verify`. W7-00 runs the same recipe against the rehearsal backup, with the blob directory restored alongside and re-verified against every `artifact.content_hash`.
- **Review checklist for any PR that adds a migration:** header present; no statements touching the frozen tables other than `CREATE INDEX`, `ALTER TABLE … ADD COLUMN … NULL` or `ADD CONSTRAINT … NOT VALID` followed by a separate `VALIDATE`; the shared enum union updated with the `CHECK`; both migration tests green.

## Retention and deletion: options for D08

D08 (DPO + IT/Security, before real data) decides retention, deletion, model-provider data handling and real-data upload limits. This section gives the options the design supports and chooses none; nothing here is implemented in slice 1 (synthetic data only). ADR-0005 is drafted at the D08 gate from these options. Immutable business versions do not exempt personal data from an approved deletion policy (data contract); the point of every option below is to honour a deletion without rewriting the version row.

### Executing an approved deletion of personal data

| Option | Mechanism | What stays readable | What a restored backup shows | Trade-offs for D08 |
|---|---|---|---|---|
| **A. Redaction event** | Append a `retention_event` row (`kind = 'redaction'`, target version/slot/artifact, approver, reason reference, time, correlation) and set `artifact.bytes_state = 'destroyed'` under `rai.retention_write`; the blob file is removed by the operator command; the metadata row, hash, slot row and audit rows stay | The version, its slot states, the fact that a document existed, its hash and size; the reviewer decisions and findings about it; download answers 410 with a locale key naming the redaction | A pre-deletion backup still holds the bytes; the runbook must define backup rotation so deletion becomes effective after the retention window | Simplest; matches "record a decision, never rewrite"; the hash of deleted bytes remains, which is a fingerprint but not content |
| **B. Blob key destruction** | Bytes are encrypted at rest with a per-artifact data key wrapped by a master key in the D10 custody mechanism; deletion destroys the data key and appends the same retention event; the ciphertext may stay or be removed | As A | Backups hold ciphertext only; destroying the key makes every copy unreadable at once, which solves A's backup problem | Requires key custody (open until D08/D10) and removes hash-based deduplication across artifacts unless the key is per blob rather than per artifact row (then deleting one case's copy deletes the other's); more moving parts in W7-00 restore |
| **C. Tombstone of case-level personal fields** | For personal data in `case` text fields (owner names in inherited fields) rather than in documents: append a `retention_event` and write a tombstone value (`[redacted:<event id>]`) to the mutable `case` column under `rai.retention_write`; frozen rows never held these values, so nothing frozen changes | Everything except the redacted field; the audit trail shows the redaction | Backup rotation as A | Only covers metadata; combined with A or B for documents |

All three keep findings, decisions, dispositions and audit rows untouched (the finding `evidence` field holds references, not text, precisely so that deleting bytes does not require touching findings). The `retention_event` table and the `rai.retention_write` gate are added by the migration that implements the chosen option, not before.

### Audit retention versus business-data retention

- Business data (case, versions, artifacts, findings, decisions): retained per D08's period; deletion executed per the option above, case by case, with an approver recorded.
- Audit events: retained for the longer of D08's audit period and any host requirement under D10; never deleted per case, because a deleted case's audit trail is how the deletion itself is proven. If D08 requires audit purge after the period, it is an operator command that deletes rows older than the cutoff by `occurred_at`, writes one `audit.purged` event with the range and count, and runs as a role that has `DELETE` on `audit_event` and nothing else; that role does not exist in slice 1 and is created only by the migration that implements D08.
- Notification rows and idempotency keys: operational, short retention (idempotency 72 h default; notifications per D08, proposed 12 months), cleaned by the operator command.

### Unsubmitted drafts and failed uploads

- **Failed uploads** never produce an `artifact` row; the temp file under `BLOB_DIR/tmp` is removed by `discard` on the error path, and `store:cleanup` removes any temp file older than one hour (a crashed process). A committed blob with no `artifact` row (transaction rolled back after `put`) is an orphan; `store:cleanup` removes blobs whose hash appears in no `artifact` row and whose mtime is older than 24 hours. Both thresholds are configuration.
- **Unsubmitted drafts**: a case whose `current_version_id IS NULL` and whose draft is untouched for `DRAFT_RETENTION_DAYS` (D08 decides; proposed 180) is listed by `db:cleanup --report` for Admin; deletion of such a case, its draft slot rows and its exclusively-referenced artifacts is an operator action that writes `case.draft_purged`. A successor draft (`parent_version_id` set) is never purged: the send-back that created it is part of a submitted version's history.
- In slice 1 the commands exist as dry-run reports only; deletion paths are enabled by the D08 migration.

### Encryption at rest and key custody

Open until D08/D10. Slice 1 stores synthetic bytes unencrypted under a `0700` directory. The `BlobStore` interface has no encryption parameter on purpose: option B is a second implementation of the same interface, chosen by configuration, not a change to callers.

## Interfaces

Type notation; the W0-02 plan fixes paths and the shared package name. These are the server-internal contracts; request/response shapes are W0-02's "W1 interface shapes".

```ts
// rai-web/shared: ids and enums (mirrors the CHECK constraints)
export type Lane = 'ai_coe' | 'dpo' | 'it_security';
export type SlotState = 'attached' | 'not_yet' | 'not_applicable' | 'missing';
export type LaneProjection = 'pending' | 'approved' | 'sent_back';
export type Readiness = 'not_ready' | 'ready';
export type DeskStatus = 'draft' | 'in_review' | 'ready';
export type ModelType = 'llm' | 'classic_ml' | 'other';
export type StageContext = 'idea' | 'pre_build' | 'pre_launch';
export type DispositionKind = 'fixed_proposed' | 'fixed' | 'fixed_confirmed' | 'waived' | 'not_applicable';   // W0-06 4.8

// rai-web/server: request context every repository call receives
export interface ActionContext {
  actor: { subjectId: string; role: Role };      // Role from W0-03
  correlationId: string;                          // W0-10
  idempotencyKey?: string;
  expectedVersionId?: string;                     // current submitted version the client acted on
  expectedRowVersion?: number;                    // for draft edits
}

export interface UnitOfWork {
  /** One business action = one call. Locks the case row, sets rai.workflow_write, enforces audit-before-commit. */
  withWorkflowTransaction<T>(ctx: ActionContext, caseId: string, fn: (tx: WorkflowTx) => Promise<ActionResult<T>>): Promise<ActionResult<T>>;
  /** Read-only transaction with no lock; used by queries. */
  read<T>(fn: (tx: ReadTx) => Promise<T>): Promise<T>;
}

export interface WorkflowTx extends ReadTx {
  cases: CaseWriteRepository;
  versions: VersionWriteRepository;
  artifacts: ArtifactMetadataRepository;
  decisions: LaneDecisionRepository;      // append only
  qc: QcRepository;                        // append only
  dispositions: DispositionRepository;    // append only
  notifications: NotificationRepository;  // append + delivery columns
  configuration: ConfigurationRepository; // publish + read
  audit: AuditLog;                         // append only
  idempotency: IdempotencyRepository;
}

export interface CaseWriteRepository {
  create(input: CreateCaseInput): Promise<CaseRow>;                                   // allocates registry_id, draft v1, nine slots
  updateDraftFields(caseId: string, fields: Partial<EditableCaseFields>, expectedRowVersion: number): Promise<CaseRow>;
  /** Workflow-only. Not reachable from routes: lives in the workflow module and needs a WorkflowTx. */
  applyLaneProjection(caseId: string, lane: Lane, value: LaneProjection): Promise<void>;
  applyReadiness(caseId: string, value: Readiness): Promise<void>;
  setVersions(caseId: string, refs: { currentVersionId?: string | null; draftVersionId?: string | null; deskStatus?: DeskStatus }): Promise<void>;
}
export type EditableCaseFields = Pick<CaseRow,
  'source_record_id' | 'use_case_name' | 'business_unit' | 'business_owner' | 'technical_owner' |
  'use_case_group' | 'vendor_involved' | 'model_type'>;                                 // no projections, no risk_tier

export interface VersionWriteRepository {
  createSuccessorDraft(caseId: string, parentVersionId: string): Promise<VersionRow>; // copies nine slots
  updateDraftSlot(versionId: string, slot: number, patch: SlotPatch): Promise<SlotRow>; // fails with FrozenVersion after submit; ArtifactCaseMismatch if patch.artifactId belongs to another case
  updateDraftContext(versionId: string, patch: { stageContext?: StageContext; checklistTemplateVersion?: string }): Promise<VersionRow>;
  freeze(versionId: string, frozen: FrozenFields): Promise<VersionRow>;               // the submit update; computes manifest_hash
}

export interface AuditLog {
  append(event: AuditEventInput): Promise<void>;   // only method that writes; validated against the reference-only schema
  read(query: AuditQuery): Promise<AuditEventRow[]>; // route-level policy check happens before this is called
}

export interface ReadyPredicate {
  /** Runs inside the Ready transaction under the case lock. Same SQL is used by the W2-08 evidence. */
  evaluate(tx: WorkflowTx, caseId: string, currentVersionId: string): Promise<
    { ready: true } | { ready: false; missingApprovals: Lane[]; undispositionedFindingIds: string[] }>;
}
```

The Ready predicate SQL, for W2-06 and W2-08 to share:

```sql
-- approvals on the current version, one per lane
SELECT lane FROM lane_decision WHERE version_id = $1 AND decision = 'approve';
-- findings on the current version whose latest disposition does not count
SELECT f.id
FROM qc_finding f
LEFT JOIN LATERAL (
  SELECT kind FROM disposition_event d WHERE d.finding_id = f.id ORDER BY d.created_at DESC, d.id DESC LIMIT 1
) latest ON true
WHERE f.version_id = $1
  AND (latest.kind IS NULL OR latest.kind = 'fixed_proposed');
```

Ready iff the first query returns exactly the three lanes and the second returns no rows. Note that an `unavailable` finding is a `qc_finding` row and therefore blocks Ready until dispositioned by its owning lane (never treated as zero findings, W2-05).

Queue and read queries (W1-02 list, W3-01 search) apply the W0-05 scope predicate **inside** the SQL `WHERE` clause (owner: `owner_subject_id = $actor`; SPOC: `business_unit_id = ANY($bus)`; reviewers and Admin: no case filter), so counts, pagination and filter options are computed over in-scope rows only (A06). A query helper `scopedCases(tx, actor)` returns the Drizzle sub-select every list query must start from; a list query that does not use it fails a lint rule W1-12 adds.

## Error contract

Persistence errors are typed in the server and mapped once, in the Fastify error handler, to the ADR-0003 codes. The store never throws a string.

| Persistence error (TypeScript class) | Raised when | Mapped to (ADR-0003) |
|---|---|---|
| `StaleVersion { currentVersionId }` | expected version or row version mismatch under the lock | 409 `stale_version`, body carries the W0-06 8.2 `reason`, `guidanceKey`, `current` and `refreshPath` |
| `FrozenVersion` | an update reached a submitted version or its slots (trigger `rai.frozen_version`) | 409 `stale_version` with `reason: 'frozen'` (the client acted on a version that has since been submitted); also an internal alert (W0-10) because a correct client never hits it |
| `ProjectionWriteForbidden` | trigger `rai.projection_write_forbidden` | 500 internal; alert. Unreachable through a valid route because the shape rejects the fields first (422 `invalid_input`) |
| `IdempotencyKeyReused` | same key, different request digest | 422 `invalid_input`, field `idempotencyKey`, key `error.idempotency_key_reused` |
| `ArtifactCaseMismatch { artifactId }` | `updateDraftSlot` given an `artifact_id` whose `artifact.case_id` is not the draft version's case | 422 `invalid_input`, field `artifactId`, key `error.artifact_case_mismatch`; no slot row changes |
| `NotFound { kind, id }` | in-scope reference to a missing row or blob metadata | 404 `not_found` |
| `BlobTooLarge` | `put` exceeded `maxBytes` | 422 `unsafe_upload` (W0-08 owns the message key) |
| `BlobIntegrity { hash, reason }` | `verify` failure, size mismatch on dedupe, or hash mismatch on a re-hashed download | 500 internal; alert; the download is aborted, never served partially as valid |
| `StoreUnavailable` | connection refused, `lock_timeout`, `BLOB_DIR` unwritable | 500 internal; `GET /readyz` reports `store.db: unreachable` or `store.blob: not_writable` (W0-10 section 5.3) |
| `UniqueViolation` on `(case_id, version_number)` or `(version_id, lane)` | a second successor or second decision slipped past the lock (should not happen) | 409 `stale_version`; alert |

Internal failures answer with HTTP 500, `code: 'internal_error'`, a generic locale key and the correlation ID; the body never carries a SQL message, a path or a hash. `internal_error` is not one of the seven W0-06 contract types; it is the catch-all W0-10 categorises, confirmed by W0-06 8.1 alongside `not_found`. No persistence failure ever surfaces as a clean or approved state (threat model).

## Test substitutes and test map

| Layer | What runs | Substitute | Never accepted as evidence for |
|---|---|---|---|
| Unit (`node:test`) | workflow rules, Ready predicate logic, manifest hashing, filename normalisation, audit-schema validation | `MemoryUnitOfWork` implementing the same interfaces with in-memory maps and a fake lock; `MemoryBlobStore` over a `Map<hash, Buffer>` | immutability, transactions, restart, A07, A11 |
| Integration (`node:test` against the ticket's Postgres, `POSTGRES_PORT` per ticket) | every trigger, grant, transaction recipe, idempotent replay, concurrent send-back (two connections, one blocked on the lock), migrations against the fixture store and a restored backup, `store:verify` | none for Postgres (deliberate: the rules live in SQL); `FilesystemBlobStore` on a temp directory | nothing; this is the evidence layer for A07 and A11 |
| Browser (Playwright, W1-INT and later) | the journeys named in the work breakdown, including the restart step | none | nothing |

Substitute rule: `MemoryUnitOfWork` and `MemoryBlobStore` live under the test path W0-02 assigns and are absent from non-test configuration (same rule as the W1-13 UI substitute); a test that asserts immutability, atomicity or restart must import the Postgres-backed implementation.

Which ticket proves which clause of this document:

| Clause | Ticket | Test |
|---|---|---|
| Configuration revision immutable; audit store has no update/delete path | W1-00 | update/delete of a published revision fails; `AuditLog` exposes only `append`/`read`; raw UPDATE/DELETE on `audit_event` fails as `rai_app` |
| Desk-local fields stored; projection writes rejected | W1-02 | `vendor_involved`/`model_type` round-trip; edit body with `privacy_status` → 422; raw UPDATE of a projection outside the workflow setting → trigger error |
| Content hash, private storage, authorized download, Thai filename | W1-03 | hash recorded equals `sha256sum`; direct path/hash URL unreachable; no-session download 401; bytes match hash; `filename*` round-trips `ตัวอย่าง.pdf` |
| Slot attach bound to the case | W1-04 | attaching an artifact uploaded under another case → 422 `invalid_input` (`artifactId`), slot row unchanged, no audit `draft.saved`; the same artifact attaches to a later version of its own case |
| Freeze, frozen columns, manifest hash, restart | W1-05, W1-INT | frozen columns non-null and equal to the configuration/mapping in force; slot update after submit → `rai.frozen_version`; restart recipe above |
| Lane decision append, projection write, stale version, idempotent replay | W2-02 | second decision on same (version, lane) rejected; projection reflects the lane; stale `expectedVersionId` → 409 and no rows; same key replays the stored response with no new rows |
| One successor under concurrency | W2-03 | two connections send back concurrently; one `pack_version` N+1; both decisions recorded; two `send_back` notification rows, one per deciding lane, and no `UniqueViolation` |
| Resubmit reopens all lanes | W2-04 | projections `pending`; no N approval counted by the predicate |
| Findings immutable, dispositions append, `unavailable` blocks | W2-05 | update of `qc_finding` fails; second disposition appends; `unavailable` finding appears in the predicate's second query |
| Ready atomic recheck | W2-06 | a disposition inserted between the client's read and the Ready call is respected; a stale approval blocks; the predicate runs inside the transaction (asserted by a failure injected after the recheck leaving no `ready` state) |
| Journey reconstructable from audit alone; audit rows immutable | W2-08 | A11 replay test; UPDATE/DELETE as both roles fail |
| Migrations forward-only, frozen digest unchanged, restored backup | W1-12 (CI), W7-00 | the two migration tests; `store:verify` |

## Configuration and commands handed to W0-02

W0-02 section 5 (variables) and 3.3 (commands) are the register; W0-09 reconciled this section to W0-02's names on 2026-09-21 and W0-02 carries every row below.

| Variable (W0-02 section 5) | Purpose | Local placeholder |
|---|---|---|
| `DATABASE_URL` | `rai_app` connection for the process; port follows `POSTGRES_PORT` | `postgres://rai_app:rai_app@127.0.0.1:54320/rai` |
| `DATABASE_MIGRATE_URL` | `rai_owner` connection for `npm run migrate` | `postgres://rai_owner:rai_owner@127.0.0.1:54320/rai` |
| `DATABASE_OPERATOR_URL` | `rai_operator` connection for cleanup and verify commands; optional locally (defaults to `DATABASE_MIGRATE_URL`) | unset |
| `POSTGRES_PORT` | host port the compose file binds (per-ticket isolation: 54320 + ticket number) | `54320` |
| `BLOB_DIR` | private blob root | `./.local/blobs` |
| `UPLOAD_MAX_FILE_BYTES`, `UPLOAD_MAX_PACK_BYTES`, `UPLOAD_MAX_IMAGE_PIXELS` | W0-08 limits passed to the store and the route | `26214400`, `157286400`, `40000000` (W0-08 section 3) |
| `IDEMPOTENCY_TTL_HOURS` | cleanup threshold | `72` |
| `BLOB_ORPHAN_MIN_AGE_HOURS`, `BLOB_TMP_MAX_AGE_HOURS` | cleanup thresholds | `24`, `1` |

Passwords above are local Docker placeholders for synthetic data only; networked and production credentials come from the D10 custody mechanism (W0-03 secrets rule) and never from a file in Git.

| Command (W0-02 section 3.3) | Runs as | Does |
|---|---|---|
| `migrate` | `rai_owner` | applies pending migrations; the only path that changes the schema |
| `reset` | `rai_operator` | development and test only: `db:down`, `db:up`, `migrate`, `fixtures:load`, and empties `rai-web/.local` (blobs, mail sink) |
| `db:cleanup [--report]` | `rai_operator` | idempotency-key expiry; draft and orphan reports (dry-run only until D08) |
| `store:verify` | `rai_operator` | re-hashes every blob referenced by an `artifact` row; reports missing, mismatched and orphan blobs; exit code non-zero on any mismatch |
| `store:cleanup` | `rai_operator` | removes stale temp files and, after D08, orphan blobs |

`docker-compose.yml` (W1-00; W0-02 section 5 shows it): Postgres 16 image pinned by W0-02, `POSTGRES_PORT:5432` mapping, named volume, and an init script under `docker/postgres/init/` that creates the three roles and the database. Two tickets run side by side by giving each its own project name and port.

## Open items

- [x] W0-05: Admin reads the audit log and the operator view in slice 1 (W0-05 section 8); out-of-scope references answer 403, an unresolvable id 404 only for an `all_cases` holder (W0-05 section 4). Recorded at W0 exit.
- [x] W0-06: `UNIQUE (version_id, lane)` confirmed (W0-06 9.3); a finding on a superseded version cannot be dispositioned (`version_superseded`, W0-06 5.2); resubmit after Ready is not reachable in slice 1 (W0-06 4.12); `not_found` and `internal_error` confirmed (W0-06 8.1). Recorded at W0 exit.
- [x] W0-02: variable and command names, the migrations path (`rai-web/server/drizzle/`), the shared package (`@rai/shared`) and the `Idempotency-Key` header confirmed and applied above (W0-09).
- [x] W0-08: sniffing rule (W0-08 section 2, hand-written, no library), the limits (25 MiB per file, 150 MiB per pack version) and the filename rule (200 NFC code points, no path or control characters) recorded in W0-08 section 3; the store's `maxBytes` and the temp-file layout (`tmp/`, `sha256/...`) are this spec's and W0-08 section 6 follows them (W0-09).
- [ ] W0-07 proposals to this spec (W0-07 section 10): a nullable `qc_run.run_key` column with a partial unique index for replay lookup by key. Not added at W0 exit; the column-based lookup in W0-07 3.7 stands until the W2-05 contract PR asks for it. The `operator_job_run` table proposed by W0-10 section 7.3 is W3-07's migration, not this spec's schema.
- [ ] D08 (DPO + IT/Security, before real data): choose among deletion options A/B/C; retention periods for business data, audit, notifications; draft retention; whether audit purge exists. ADR-0005 drafted then.
- [ ] D10 (IT/Security + accountable owner): key custody for option B; production database roles and backup target for the restore test.
- [ ] W5: `risk_tier` writer arrives with the rubric (D07); the column and its write gate exist from W1-00 so that no earlier ticket writes it.

## References

- [W0 technical contract](../delivery/w0-technical-contract.md) — W0-04 section, exit checklist; W0-02, W0-03, W0-05, W0-06, W0-07, W0-08, W0-10 sections cited above
- [ADR-0003 stack and deployment boundary](../../adr/0003-stack-and-deployment-boundary.md) — D04, error codes
- [ADR index](../../adr/README.md) — ADR-0005 reserved for D08, drafted from this document's options
- [Decision register](../product/decisions.md) — D02, D05, D06, D11, D12, W0-04 fields; D08, D10 open
- [Data contract](../product/data-contract.md), [workflow contract](../product/workflow.md), [source spec](../product/source-spec.md) (frozen)
- [Acceptance](../acceptance.md) — A07, A09, A11; [threat model](../security/threat-model.md)
- [Architecture](../architecture/README.md) — boundary table; "Path in repo" filled by W0-02
- [Slice 1 work breakdown](../delivery/slice-1-work-breakdown.md) — consuming tickets; [later packages](../delivery/later-packages-outline.md) — W6, W7-00, W8
