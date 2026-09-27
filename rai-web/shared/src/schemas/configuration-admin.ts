// W6-01 contract (W6 plan section 4.2): the Admin configuration API shapes. W6-04 serves them under
// `/api/admin/configuration`; W6-05 to W6-07 render them. Drafts are mutable working copies (Q1); publishing copies a
// draft into an immutable `configuration_revision` (W0-04); restore publishes a copy of an older body as N+1 (Q3).
// Every choice here is a provisional agent-team ruling under Ta's delegation of 2026-09-27 (W6 plan section 1.2).
// Values owned by D07, D09 and D10 are provisional working assumptions held as configuration, never set here.

import { Type, type Static } from 'typebox';
import { CONFIGURATION_KINDS, type ConfigurationKind } from './cases.js';

/** A person's note on a publish or restore (W6 plan section 2.3): required, 1-500 characters. Seed rows have none. */
export const CHANGE_NOTE_MAX_LENGTH = 500;
/** Q18: a draft saves any JSON object up to this size; only publish refuses an invalid body. */
export const CONFIGURATION_DRAFT_MAX_BYTES = 64 * 1024;
export const CONFIGURATION_REVISION_LIST_DEFAULTS = Object.freeze({ page: 1, pageSize: 25 });

/** Who owns the values a kind holds. Admin edits every kind; the badge says whose decision the values are. */
export const CONFIGURATION_VALUES_OWNERS = ['admin', 'D07', 'D09', 'D10'] as const;
export type ConfigurationValuesOwner = (typeof CONFIGURATION_VALUES_OWNERS)[number];

/**
 * Per kind (W6 plan section 2.1). `qc_rules` is Admin's; its content-rule thresholds are D09's and the editor badges
 * those params one by one (Q7). `risk_rubric` is D07's (Q8) and `group_role_mapping` D10's (Q9). Exhaustive over
 * `ConfigurationKind`, so a kind added later must name its owner here (W6-02 added `desk_controls`).
 */
export const CONFIGURATION_VALUES_OWNER: Readonly<Record<ConfigurationKind, ConfigurationValuesOwner>> =
  Object.freeze({
    checklist_templates: 'admin',
    qc_rules: 'admin',
    sla: 'admin',
    calendar: 'admin',
    operator_recipients: 'admin',
    use_case_groups: 'admin',
    risk_rubric: 'D07',
    group_role_mapping: 'D10',
    desk_controls: 'admin', // W6-02: the incident switches are an operator choice (Q12)
  });

// Derived from the one kind list (the lane mapping is never a kind, D02).
export const ConfigurationKindSchema = Type.Enum(CONFIGURATION_KINDS);
const ValuesOwnerSchema = Type.Enum(CONFIGURATION_VALUES_OWNERS);

const object = <T extends Parameters<typeof Type.Object>[0]>(fields: T) =>
  Type.Object(fields, { additionalProperties: false });
const count = Type.Integer({ minimum: 0 });
const timestamp = Type.String({ minLength: 1 }); // ISO instant, as every other read shape serves it
export const ChangeNoteSchema = Type.String({ minLength: 1, maxLength: CHANGE_NOTE_MAX_LENGTH });
/** A configuration body is a JSON object (never an array, string or null); its per-kind schema is checked on publish. */
export const ConfigurationBodySchema = Type.Record(Type.String(), Type.Unknown());
/** W0-06 8.2 `FieldError`: a JSON path and a locale key, never rendered text. */
export const ConfigurationProblemSchema = object({
  path: Type.String(),
  messageKey: Type.String({ minLength: 1 }),
  params: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Number()]))),
});

const revisionSummaryFields = {
  revisionId: Type.String({ minLength: 1 }),
  kind: ConfigurationKindSchema,
  revisionNumber: Type.Integer({ minimum: 1 }),
  publishedAt: timestamp,
  publishedBy: Type.String({ minLength: 1 }), // subject ID
  publishedByDisplayName: Type.Optional(Type.String()), // display only; absent when the subject is unknown
  changeNote: Type.Union([ChangeNoteSchema, Type.Null()]), // null on seed rows
  restoresRevisionNumber: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]), // set on a restore (Q3)
  inForce: Type.Boolean(),
  /** How many submitted versions froze this revision (`pack_version.frozen_configuration ->> kind = id`). */
  frozenOnVersionCount: count,
};
export const ConfigurationRevisionSummarySchema = object(revisionSummaryFields);
export type ConfigurationRevisionSummary = Static<typeof ConfigurationRevisionSummarySchema>;

export const ConfigurationRevisionDetailSchema = object({
  ...revisionSummaryFields,
  body: ConfigurationBodySchema,
});
export type ConfigurationRevisionDetail = Static<typeof ConfigurationRevisionDetailSchema>;

/** One draft per kind (Q1); `draftVersion` is the optimistic counter every draft write names (Q5). */
const draftSummaryFields = {
  kind: ConfigurationKindSchema,
  baseRevisionId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]), // the revision the draft started from
  draftVersion: Type.Integer({ minimum: 1 }),
  updatedBy: Type.String({ minLength: 1 }),
  updatedByDisplayName: Type.Optional(Type.String()),
  updatedAt: timestamp,
  changeNote: Type.Union([ChangeNoteSchema, Type.Null()]),
  problemCount: count, // what publish would refuse today (schema and cross-kind checks, W6-03)
};
export const ConfigurationDraftSummarySchema = object(draftSummaryFields);
export type ConfigurationDraftSummary = Static<typeof ConfigurationDraftSummarySchema>;

export const ConfigurationDraftDetailSchema = object({
  ...draftSummaryFields,
  body: ConfigurationBodySchema,
  problems: Type.Array(ConfigurationProblemSchema),
});
export type ConfigurationDraftDetail = Static<typeof ConfigurationDraftDetailSchema>;

// ---- reads ------------------------------------------------------------------------------------------------------

/** `GET /api/admin/configuration`. `editable` is false for a kind with no registered body schema (deny by default). */
export const ConfigurationIndexResponseSchema = object({
  kinds: Type.Array(
    object({
      kind: ConfigurationKindSchema,
      editable: Type.Boolean(),
      valuesOwner: ValuesOwnerSchema,
      current: Type.Union([ConfigurationRevisionSummarySchema, Type.Null()]),
      draft: Type.Union([ConfigurationDraftSummarySchema, Type.Null()]),
    }),
  ),
});
export type ConfigurationIndexResponse = Static<typeof ConfigurationIndexResponseSchema>;

/**
 * Path parameters are plain strings: a kind outside `CONFIGURATION_KINDS`, or a revision ID that is malformed or of
 * another kind, is answered 404 `not_found` with resource `configuration` by the route, never 422 by validation.
 */
export const ConfigurationKindParamsSchema = object({ kind: Type.String({ minLength: 1, maxLength: 64 }) });
export const ConfigurationRevisionParamsSchema = object({
  kind: Type.String({ minLength: 1, maxLength: 64 }),
  revisionId: Type.String({ minLength: 1, maxLength: 64 }),
});

/** `GET …/{kind}/revisions`: newest first. */
export const ConfigurationRevisionListQuerySchema = object({
  page: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000000 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});
export type ConfigurationRevisionListQuery = Static<typeof ConfigurationRevisionListQuerySchema>;
export const ConfigurationRevisionListResponseSchema = object({
  items: Type.Array(ConfigurationRevisionSummarySchema),
  total: count,
});
export type ConfigurationRevisionListResponse = Static<typeof ConfigurationRevisionListResponseSchema>;

/** `GET …/{kind}/draft`. */
export const ConfigurationDraftResponseSchema = object({
  draft: Type.Union([ConfigurationDraftDetailSchema, Type.Null()]),
});
export type ConfigurationDraftResponse = Static<typeof ConfigurationDraftResponseSchema>;

// ---- writes (action config.publish; 409 stale_version `configuration_changed` on any optimistic mismatch) ---------

/**
 * `PUT …/{kind}/draft`. `expectedDraftVersion` is null only when no draft exists yet; `baseRevisionId` is the revision
 * in force the Admin started from (null before any publish). The body may be half-finished (Q18); over
 * `CONFIGURATION_DRAFT_MAX_BYTES` it is 422.
 */
export const SaveConfigurationDraftRequestSchema = object({
  baseRevisionId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  expectedDraftVersion: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  body: ConfigurationBodySchema,
  changeNote: Type.Optional(ChangeNoteSchema),
});
export type SaveConfigurationDraftRequest = Static<typeof SaveConfigurationDraftRequestSchema>;

/** `DELETE …/{kind}/draft`. */
export const DiscardConfigurationDraftRequestSchema = object({
  expectedDraftVersion: Type.Integer({ minimum: 1 }),
});
export type DiscardConfigurationDraftRequest = Static<typeof DiscardConfigurationDraftRequestSchema>;

/**
 * `POST …/{kind}/draft/publish` → 201 revision summary. The change note is the draft's, or this request's when the
 * publish dialog supplies one; publishing without either is 422 (a person's publish always has a note).
 */
export const PublishConfigurationDraftRequestSchema = object({
  expectedDraftVersion: Type.Integer({ minimum: 1 }),
  expectedCurrentRevisionId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  changeNote: Type.Optional(ChangeNoteSchema),
});
export type PublishConfigurationDraftRequest = Static<typeof PublishConfigurationDraftRequestSchema>;

/** `POST …/{kind}/revisions/{revisionId}/restore` → 201 revision summary with `restoresRevisionNumber` set. */
export const RestoreConfigurationRevisionRequestSchema = object({
  expectedCurrentRevisionId: Type.String({ minLength: 1 }),
  changeNote: ChangeNoteSchema,
});
export type RestoreConfigurationRevisionRequest = Static<typeof RestoreConfigurationRevisionRequestSchema>;

// ---- the "configuration used" panel of a submitted version (W6 plan section 4.3; W6-09 serves it) ---------------

/** One revision frozen on a version; `label` is the `qc_rules` body label, else null. */
export const FrozenConfigurationEntrySchema = object({
  kind: ConfigurationKindSchema,
  revisionId: Type.String({ minLength: 1 }),
  revisionNumber: Type.Integer({ minimum: 1 }),
  label: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
});
export type FrozenConfigurationEntry = Static<typeof FrozenConfigurationEntrySchema>;
