// W0-02 section 7.3: case create/edit/read/list and configuration read (W1-02 serves; W1-07, W1-06 consume).

import { Type, type Static, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import type { CaseId, ConfigurationRevisionId, RegistryId, SubjectId } from '../ids.js';
import type { Lane } from './auth.js';
import { type DraftSummarySchema } from './pack.js';
import { type VersionSummarySchema } from './versions.js';

export const SourceRecordIdSchema = Type.Union([
  Type.Object({ kind: Type.Literal('known'), value: Type.String({ minLength: 1 }) }), // 'TPM-…' or 'VRO-…'; never looked up (L3, L6, L10)
  Type.Object({ kind: Type.Literal('unknown') }), // the literal Unknown of the source spec
]);
export type SourceRecordId = Static<typeof SourceRecordIdSchema>;

export const MODEL_TYPES = ['llm', 'classic_ml', 'other'] as const; // desk-local (W0-04 fields)
export type ModelType = (typeof MODEL_TYPES)[number];
export const ModelTypeSchema = Type.Union([
  Type.Literal('llm'),
  Type.Literal('classic_ml'),
  Type.Literal('other'),
]); // a tuple, not MODEL_TYPES.map(): a mapped array widens the inferred type to never (W1-02, as W1-01 did for IdentityMode)

export type RiskTier = string; // opaque placeholder: D07 records the labels before W5; null throughout slice 1

export const LANE_PROJECTION_STATUSES = ['pending', 'approved', 'sent_back'] as const; // confirmed by W0-04
export type LaneProjectionStatus = (typeof LANE_PROJECTION_STATUSES)[number];
export const READINESS_PROJECTION_STATUSES = ['not_ready', 'ready'] as const;
export type ReadinessProjectionStatus = (typeof READINESS_PROJECTION_STATUSES)[number];

// W0-06 section 2.4 derived vocabulary, verbatim; no other value exists.
export const CASE_STATUSES = [
  'draft',
  'in_review',
  'sent_back',
  'awaiting_disposition',
  'ready_for_launch',
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CaseWritableFieldsSchema = Type.Object({
  useCaseName: Type.String({ minLength: 1, maxLength: 200 }),
  businessUnitId: Type.String({ minLength: 1 }), // the scope key (W0-04 case.business_unit_id); must be a configured BU key
  businessUnit: Type.String({ minLength: 1, maxLength: 100 }), // inherited descriptive text; never used for access
  businessOwner: Type.String({ minLength: 1 }), // SubjectId stored as owner_subject_id; defaults to the actor for role owner
  technicalOwner: Type.String({ minLength: 1, maxLength: 200 }),
  sourceRecordId: SourceRecordIdSchema,
  useCaseGroup: Type.String({ minLength: 1 }), // must be in ConfigurationView.useCaseGroups (D11)
  vendorInvolved: Type.Boolean(), // desk-local; drives the slot 3/4 default (W1-04)
  modelType: ModelTypeSchema, // desk-local
});
export type CaseWritableFields = Static<typeof CaseWritableFieldsSchema>;

export interface CaseView extends CaseWritableFields {
  caseId: CaseId;
  registryId: RegistryId;
  status: CaseStatus;
  riskTier: RiskTier | null;
  privacyStatus: LaneProjectionStatus; // written only by the workflow: DPO approval (W0-04 fields)
  securityStatus: LaneProjectionStatus; // IT/Security approval
  raiStatus: LaneProjectionStatus; // AI/COE approval
  aiReadinessStatus: ReadinessProjectionStatus; // Ready transition
  currentVersion: Static<typeof VersionSummarySchema> | null;
  draft: Static<typeof DraftSummarySchema> | null;
  caseRevision: number; // W0-04 case.row_version
  createdBy: SubjectId;
  /** Display only (W3-F1): the W0-04 descriptive `business_owner` text; `businessOwner` stays the SubjectId. */
  ownerDisplayName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CaseSummary {
  caseId: CaseId;
  registryId: RegistryId;
  useCaseName: string;
  businessUnitId: string;
  businessUnit: string;
  businessOwner: SubjectId;
  ownerDisplayName?: string; // display only (W3-F1), as CaseView
  useCaseGroup: string;
  status: CaseStatus;
  currentVersionNumber: number | null;
  updatedAt: string;
}

export const CaseCreateRequestSchema = CaseWritableFieldsSchema;
export type CaseCreateRequest = CaseWritableFields;

// Any key outside CaseWritableFields → 422 invalid_input at body.fields.<key>: a projected name (privacyStatus) as
// error.invalid_input.projected_field from the route hook, any other name as validation.unknown_field from this
// additionalProperties: false (the server turns Ajv's removeAdditional off so the key is rejected, not stripped).
export const CaseUpdateRequestSchema = Type.Object({
  expectedCaseRevision: Type.Integer({ minimum: 1 }),
  fields: Type.Partial(CaseWritableFieldsSchema, { additionalProperties: false }),
});
export type CaseUpdateRequest = Static<typeof CaseUpdateRequestSchema>;

export const CaseListQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});
export type CaseListQuery = Static<typeof CaseListQuerySchema>;
export const CASE_LIST_DEFAULTS = Object.freeze({ page: 1, pageSize: 25 });

export interface CaseListResponse {
  items: CaseSummary[];
  page: number;
  pageSize: number;
  total: number;
}

/** The published revision that applies now (W1-00 seed; W6 edits). */
export interface ConfigurationView {
  revisionId: ConfigurationRevisionId;
  publishedAt: string;
  useCaseGroups: string[]; // D11 value list
  checklistTemplateVersions: string[]; // the draft records one
  slaWorkingDays: Record<Lane, number>; // { ai_coe: 5, dpo: 3, it_security: 5 } (D01)
  timezone: 'Asia/Bangkok'; // D06, constant
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration revision bodies (W0-04 `configuration_revision.body`: "schema per kind in rai-web/shared, validated
// on write"). One kind per revision. The W1-00 seed publishes checklist_templates, sla, calendar, operator_recipients
// and use_case_groups; W4-02 adds qc_rules (revision 1, 'w4a.1'); risk_rubric arrives with W5 (D07), group_role_mapping
// with W6/W8. A kind without a registered schema cannot be published (deny by default).
// ---------------------------------------------------------------------------------------------------------------

export const CONFIGURATION_KINDS = [
  'checklist_templates',
  'qc_rules',
  'sla',
  'calendar',
  'operator_recipients',
  'use_case_groups',
  'risk_rubric',
  'group_role_mapping',
] as const;
export type ConfigurationKind = (typeof CONFIGURATION_KINDS)[number];

export const ACTIVATION_RULES = ['after_publish'] as const; // W1-00 provisional rule until W6
export type ActivationRule = (typeof ACTIVATION_RULES)[number];

const ISO_DATE = '^\\d{4}-\\d{2}-\\d{2}$';
const EMAIL_LIKE = '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$';

export const ChecklistTemplatesBodySchema = Type.Object({
  versions: Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { minItems: 1 }), // e.g. ['v1.0 Sheet3', 'v2.0']; the draft records one
});
export const SlaBodySchema = Type.Object({
  dpo: Type.Integer({ minimum: 1, maximum: 60 }), // working days (D01: 3)
  ai_coe: Type.Integer({ minimum: 1, maximum: 60 }), // D01: 5
  it_security: Type.Integer({ minimum: 1, maximum: 60 }), // D01: 5
});
export const CalendarBodySchema = Type.Object({
  timezone: Type.Literal('Asia/Bangkok'), // D06
  holidays: Type.Array(Type.String({ pattern: ISO_DATE })), // YYYY-MM-DD; Thai public-holiday list (D06), Admin-editable from W6
});
export const OperatorRecipientsBodySchema = Type.Object({
  addresses: Type.Array(Type.String({ pattern: EMAIL_LIKE, maxLength: 254 }), { minItems: 1 }), // D06; slice 1: the single synthetic address
});
export const UseCaseGroupsBodySchema = Type.Object({
  groups: Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { minItems: 1 }), // D11 value list
});
// W4-02 (W4a plan section 3): the rule catalogue, keyed by checklist_template_version (L12). The revision a run
// records is this body's configuration_revision.id, never `label`. Rule lists and severities are provisional until
// D09. Content rules are catalogued for W4b and not executed in W4a.
export const QC_RULE_ENGINES = ['metadata', 'content'] as const;
export type QcRuleEngine = (typeof QC_RULE_ENGINES)[number];
const QC_RULE_ID = '^[A-Z]+(-[A-Z0-9]+)+$'; // QC_RULE_ID_PATTERN (shared/src/qc/types.ts)
const SlotListSchema = Type.Array(Type.Integer({ minimum: 1, maximum: 9 }), { uniqueItems: true });
const StageSlotsSchema = Type.Object(
  {
    idea: Type.Optional(SlotListSchema),
    pre_build: Type.Optional(SlotListSchema),
    pre_launch: Type.Optional(SlotListSchema),
  },
  { additionalProperties: false },
);
/** `PACK-STAGE-MISMATCH` (plan section 4): per stage, the slots that may not be attached / not yet at that stage. */
export const StageMismatchParamsSchema = Type.Object(
  { attachedForbiddenAt: StageSlotsSchema, notYetForbiddenAt: StageSlotsSchema },
  { additionalProperties: false },
);
/** Rule-specific `params`, schema-checked per rule ID on write. A rule without an entry here carries no params. */
export const QC_RULE_PARAMS_SCHEMAS = Object.freeze({
  'PACK-STAGE-MISMATCH': StageMismatchParamsSchema,
});
export const QcRuleEntrySchema = Type.Object(
  {
    ruleId: Type.String({ pattern: QC_RULE_ID, maxLength: 100 }),
    engine: Type.Union([Type.Literal('metadata'), Type.Literal('content')]), // W4a executes only 'metadata'
    triggers: Type.Array(
      Type.Union([Type.Literal('upload'), Type.Literal('submit'), Type.Literal('approve_attempt')]),
      {
        minItems: 1,
        uniqueItems: true,
      },
    ),
    severity: Type.Union([Type.Literal('high'), Type.Literal('medium'), Type.Literal('low')]), // W0-07 3.3 Severity
    params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
);
export type QcRuleEntry = Static<typeof QcRuleEntrySchema>;
export const QcRulesBodySchema = Type.Object(
  {
    label: Type.String({ minLength: 1, maxLength: 100 }), // human label, e.g. 'w4a.1'; never the recorded revision
    templates: Type.Record(
      Type.String({ minLength: 1, maxLength: 100 }), // checklist_template_version, e.g. 'v1.0 Sheet3', 'v2.0'
      Type.Object({ rules: Type.Array(QcRuleEntrySchema) }, { additionalProperties: false }),
    ),
  },
  { additionalProperties: false },
);

/**
 * The checks a `qc_rules` body needs beyond its schema: `QC-UNAVAILABLE` is the orchestrator's alone (W0-07 3.6), a
 * template lists a rule ID once, and `params` match the rule's registered schema (none when it has no schema).
 * Returns problem strings; empty when the body is valid. Call only on a body that passed `QcRulesBodySchema`.
 */
export function qcRulesBodyProblems(body: Static<typeof QcRulesBodySchema>): string[] {
  const problems: string[] = [];
  const paramSchemas: Readonly<Record<string, TSchema>> = QC_RULE_PARAMS_SCHEMAS;
  for (const [template, { rules }] of Object.entries(body.templates)) {
    const seen = new Set<string>();
    for (const rule of rules) {
      const at = `/templates/${template}/${rule.ruleId}`;
      if (rule.ruleId === 'QC-UNAVAILABLE')
        problems.push(`${at} QC-UNAVAILABLE is built by the orchestrator only`);
      if (seen.has(rule.ruleId)) problems.push(`${at} ${rule.ruleId} is listed twice`);
      seen.add(rule.ruleId);
      const schema = Object.hasOwn(paramSchemas, rule.ruleId) ? paramSchemas[rule.ruleId] : undefined;
      if (schema === undefined) {
        if (rule.params !== undefined) problems.push(`${at} ${rule.ruleId} takes no params`);
      } else if (!Value.Check(schema, rule.params)) {
        problems.push(`${at} ${rule.ruleId} params do not match its schema`);
      }
    }
  }
  return problems;
}

export const CONFIGURATION_BODY_SCHEMAS = Object.freeze({
  checklist_templates: ChecklistTemplatesBodySchema,
  sla: SlaBodySchema,
  calendar: CalendarBodySchema,
  operator_recipients: OperatorRecipientsBodySchema,
  use_case_groups: UseCaseGroupsBodySchema,
  qc_rules: QcRulesBodySchema,
}) satisfies Partial<Record<ConfigurationKind, unknown>>;

export type ConfigurationBodies = {
  checklist_templates: Static<typeof ChecklistTemplatesBodySchema>;
  sla: Static<typeof SlaBodySchema>;
  calendar: Static<typeof CalendarBodySchema>;
  operator_recipients: Static<typeof OperatorRecipientsBodySchema>;
  use_case_groups: Static<typeof UseCaseGroupsBodySchema>;
  qc_rules: Static<typeof QcRulesBodySchema>;
};
export type SeedableConfigurationKind = keyof ConfigurationBodies;
