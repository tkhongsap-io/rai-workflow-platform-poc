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

/**
 * W5-05 (R-9): the tier codes of `case.risk_tier` and the risk proposal. `unknown` when missing answers or evidence
 * leave more than one tier possible (never read as Low). Display labels come from the rubric's `tierLabels` (D07).
 */
export const RISK_TIERS = ['high', 'medium', 'low', 'unknown'] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

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
  /**
   * W5-09: the case's proposed risk tier, as `CaseView.riskTier` (null before any submit or when the proposal was
   * unavailable). Optional only because the frozen in-memory API substitute builds this shape (and `QueueItem`)
   * without it; the real server always serves it, and the web reads an absent value as null (no chip).
   */
  riskTier?: RiskTier | null;
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
// and use_case_groups; W4-02 adds qc_rules (revision 1, 'w4a.1'); risk_rubric arrives with W5 (schema W5-01,
// registered W5-02; content D07), group_role_mapping with W6/W8; W6-02 adds desk_controls (registered and seeded,
// W6 plan section 3). A kind without a registered schema cannot be published (deny by default). The db copy of this
// list (server/src/db/schema/configuration-revision.ts) changes with it; a unit test asserts they are equal.
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
  'desk_controls', // W6-02: the incident switches (W6 plan section 7, Q12); not frozen on a version
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
/**
 * W6-02 (W6 plan sections 2.1 and 7, Q12): the desk's incident switches, published by Admin like any kind and read per
 * request by W6-17. A missing or invalid body means every switch is off. Never frozen on a version.
 */
export const DeskControlsBodySchema = Type.Object(
  { writesFrozen: Type.Boolean(), mailPaused: Type.Boolean(), qcPaused: Type.Boolean() },
  { additionalProperties: false },
);
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
// W4-06a (W4b plan sections 3.2 and 3.3; decision 10, WA-D09): the synthetic claim grammar's bilingual label lists
// are catalogue data, never code, so the D09 owners can retune them. Every content rule's params carry `slots` (never
// slot 9), `labels`, `items` and `claimSource`; each rule adds its own fields. Provisional until D09.
const LabelWordSchema = Type.String({ minLength: 1, maxLength: 100 });
/** One bilingual label list: the words that mean one thing, in English and in Thai (matched after NFC + case fold). */
export const BilingualLabelListSchema = Type.Object(
  {
    en: Type.Array(LabelWordSchema, { minItems: 1, maxItems: 20, uniqueItems: true }),
    th: Type.Array(LabelWordSchema, { minItems: 1, maxItems: 20, uniqueItems: true }),
  },
  { additionalProperties: false },
);
/** The grammar's column keys (plan section 3.2); a `key: value` pair or an XLSX header cell names one of them. */
export const CLAIM_COLUMN_KEYS = [
  'item',
  'question',
  'answer',
  'metric',
  'value',
  'unit',
  'denominator',
  'threshold',
  'evidence',
  'tier',
] as const;
export type ClaimColumnKey = (typeof CLAIM_COLUMN_KEYS)[number];
export const ClaimLabelsSchema = Type.Object(
  {
    keys: Type.Object(
      {
        item: BilingualLabelListSchema,
        question: BilingualLabelListSchema,
        answer: BilingualLabelListSchema,
        metric: BilingualLabelListSchema,
        value: BilingualLabelListSchema,
        unit: BilingualLabelListSchema,
        denominator: BilingualLabelListSchema,
        threshold: BilingualLabelListSchema,
        evidence: BilingualLabelListSchema,
        tier: BilingualLabelListSchema,
      },
      { additionalProperties: false },
    ),
    // Answers normalise to yes | no | na; any other word is `unknown`.
    answers: Type.Object(
      { yes: BilingualLabelListSchema, no: BilingualLabelListSchema, na: BilingualLabelListSchema },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type ClaimLabels = Static<typeof ClaimLabelsSchema>;
const ContentSlotListSchema = Type.Array(Type.Integer({ minimum: 1, maximum: 8 }), {
  minItems: 1,
  uniqueItems: true,
}); // no content rule reads slot 9 (plan section 3.3)
/** `grammar`: claims come from the grammar only (the seed). `grammar+model`: the model port may propose (W4-07). */
const ClaimSourceSchema = Type.Union([Type.Literal('grammar'), Type.Literal('grammar+model')]);
const MetricIdSchema = Type.String({ pattern: '^[a-z][a-z0-9_]{0,63}$' }); // a message-param key (plan 3.1)
/** `ACC-METRIC-CITED` (plan section 3.3): the slots it may read, labels, the two items it judges, accepted metrics. */
export const AccMetricCitedParamsSchema = Type.Object(
  {
    slots: ContentSlotListSchema,
    labels: ClaimLabelsSchema,
    items: Type.Object(
      { hallucination: BilingualLabelListSchema, accuracy: BilingualLabelListSchema },
      { additionalProperties: false },
    ),
    acceptedMetrics: Type.Array(MetricIdSchema, { minItems: 1, uniqueItems: true }),
    claimSource: ClaimSourceSchema,
  },
  { additionalProperties: false },
);
export type AccMetricCitedParams = Static<typeof AccMetricCitedParamsSchema>;
/**
 * `ACC-EXTRACTION-NOT-HALLUCINATION` (W4-06b, plan section 3.3): the slots it may read, labels, the hallucination item
 * and the extraction metrics that are never a hallucination rate.
 */
export const AccExtractionNotHallucinationParamsSchema = Type.Object(
  {
    slots: ContentSlotListSchema,
    labels: ClaimLabelsSchema,
    items: Type.Object({ hallucination: BilingualLabelListSchema }, { additionalProperties: false }),
    extractionMetrics: Type.Array(MetricIdSchema, { minItems: 1, uniqueItems: true }),
    claimSource: ClaimSourceSchema,
  },
  { additionalProperties: false },
);
export type AccExtractionNotHallucinationParams = Static<typeof AccExtractionNotHallucinationParamsSchema>;
/**
 * `ACC-CLASSIC-ML-METRIC` (W4-06b, plan section 3.3): the slots it may read, labels, the model-performance item and
 * the metrics that match a classic-ML model (source spec: "that sheet's matching metric or N/A").
 */
export const AccClassicMlMetricParamsSchema = Type.Object(
  {
    slots: ContentSlotListSchema,
    labels: ClaimLabelsSchema,
    items: Type.Object({ classic_ml_performance: BilingualLabelListSchema }, { additionalProperties: false }),
    matchingMetrics: Type.Array(MetricIdSchema, { minItems: 1, uniqueItems: true }),
    claimSource: ClaimSourceSchema,
  },
  { additionalProperties: false },
);
export type AccClassicMlMetricParams = Static<typeof AccClassicMlMetricParamsSchema>;
/** A non-negative decimal string (a band in percent), as `decimal.ts` parses it: no sign, exponent or `%`. */
const BandDecimalSchema = Type.String({ pattern: '^\\d{1,18}(\\.\\d{1,18})?$' });
/**
 * `ACC-BAND-V1-SHEET3` (W4-06c, plan section 3.3): the slots it may read, labels, the hallucination item, the metrics
 * whose value is banded, the tier words (a claim's `tier` field) and each tier's band in percent (strict less-than
 * passes). The bands are those of checklist template v1.0 Sheet 3 only (L12); the catalogue lists the rule there only.
 */
export const AccBandV1Sheet3ParamsSchema = Type.Object(
  {
    slots: ContentSlotListSchema,
    labels: ClaimLabelsSchema,
    items: Type.Object({ hallucination: BilingualLabelListSchema }, { additionalProperties: false }),
    bandMetrics: Type.Array(MetricIdSchema, { minItems: 1, uniqueItems: true }),
    tiers: Type.Object(
      { high: BilingualLabelListSchema, medium: BilingualLabelListSchema, low: BilingualLabelListSchema },
      { additionalProperties: false },
    ),
    bands: Type.Object(
      { high: BandDecimalSchema, medium: BandDecimalSchema, low: BandDecimalSchema },
      { additionalProperties: false },
    ),
    claimSource: ClaimSourceSchema,
  },
  { additionalProperties: false },
);
export type AccBandV1Sheet3Params = Static<typeof AccBandV1Sheet3ParamsSchema>;
/** A pack fact's ID: a message-param key and a claim key (decision 30), e.g. `personal_data`. */
const FactIdSchema = Type.String({ pattern: '^[a-z][a-z0-9_]{0,63}$' });
/**
 * `PACK-CONTRADICTION` (W4-06d, plan section 3.3): the slots it may read, labels, the keywords of each pack fact
 * (`items`, keyed by fact ID) and the facts it compares, each with the slots whose artifacts state it (at least two).
 * `packContradictionParamsProblems` checks what the schema cannot: every fact once, with keywords, on read slots only.
 */
export const PackContradictionParamsSchema = Type.Object(
  {
    slots: ContentSlotListSchema,
    labels: ClaimLabelsSchema,
    items: Type.Record(FactIdSchema, BilingualLabelListSchema, { minProperties: 1, maxProperties: 16 }),
    facts: Type.Array(
      Type.Object(
        {
          id: FactIdSchema,
          slots: Type.Array(Type.Integer({ minimum: 1, maximum: 8 }), { minItems: 2, uniqueItems: true }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 16 },
    ),
    claimSource: ClaimSourceSchema,
  },
  { additionalProperties: false },
);
export type PackContradictionParams = Static<typeof PackContradictionParamsSchema>;

/**
 * The cross-field checks of `PACK-CONTRADICTION` params that passed their schema: a fact listed once, with keywords
 * in `items`, read only from slots the rule reads (`slots`); no keywords for an unlisted fact. Empty when consistent.
 * Publishing refuses a problem (`qcRulesBodyProblems`), and the content runner treats one as invalid params.
 */
export function packContradictionParamsProblems(params: PackContradictionParams): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const read = new Set(params.slots);
  for (const fact of params.facts) {
    if (seen.has(fact.id)) problems.push(`fact ${fact.id} is listed twice`);
    seen.add(fact.id);
    if (!Object.hasOwn(params.items, fact.id)) problems.push(`fact ${fact.id} has no keywords`);
    for (const slot of fact.slots)
      if (!read.has(slot)) problems.push(`fact ${fact.id} reads slot ${slot}, which the rule does not read`);
  }
  for (const id of Object.keys(params.items))
    if (!seen.has(id)) problems.push(`keywords ${id} belong to no fact`);
  return problems;
}

/** The fields every content rule's params share (the runner reads these before the rule runs). */
export interface ContentRuleBaseParams {
  slots: number[];
  labels: ClaimLabels;
  claimSource: 'grammar' | 'grammar+model';
}

/** Rule-specific `params`, schema-checked per rule ID on write. A rule without an entry here carries no params. */
export const QC_RULE_PARAMS_SCHEMAS = Object.freeze({
  'PACK-STAGE-MISMATCH': StageMismatchParamsSchema,
  'ACC-METRIC-CITED': AccMetricCitedParamsSchema, // W4-06a
  'ACC-EXTRACTION-NOT-HALLUCINATION': AccExtractionNotHallucinationParamsSchema, // W4-06b
  'ACC-CLASSIC-ML-METRIC': AccClassicMlMetricParamsSchema, // W4-06b
  'ACC-BAND-V1-SHEET3': AccBandV1Sheet3ParamsSchema, // W4-06c
  'PACK-CONTRADICTION': PackContradictionParamsSchema, // W4-06d
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
      } else if (rule.ruleId === 'PACK-CONTRADICTION') {
        const params = rule.params as unknown as PackContradictionParams;
        for (const problem of packContradictionParamsProblems(params))
          problems.push(`${at} ${rule.ruleId} params: ${problem}`);
      }
    }
  }
  return problems;
}

// W5-01 (W5 plan section 3): the `risk_rubric` body, the versioned questionnaire and its count rules. Defined here and
// checked by `riskRubricBodyProblems`; W5-02 registered it in CONFIGURATION_BODY_SCHEMAS and seeds the placeholder.
// Every value W5 seeds is a SYNTHETIC PLACEHOLDER for D07 (AI/COE): `provenance` accepts only 'synthetic_placeholder'
// (R-2), so no W5 code path can call a rubric approved; the D07 instrument needs its own schema change.
const BilingualSchema = Type.Object(
  { th: Type.String({ minLength: 1, maxLength: 500 }), en: Type.String({ minLength: 1, maxLength: 500 }) },
  { additionalProperties: false },
); // D12: Admin-owned text carries both languages in the body
// A literal tuple, not SlotNumberSchema's mapped array: TypeBox infers `never` from a Union over a mapped literal array
// (the AllowedMediaTypeSchema / StageContextSchema fix).
const EvidenceSlotSchema = Type.Union([
  Type.Literal(1),
  Type.Literal(2),
  Type.Literal(3),
  Type.Literal(4),
  Type.Literal(5),
  Type.Literal(6),
  Type.Literal(7),
  Type.Literal(8),
  Type.Literal(9),
]);
const RiskLevelSchema = Type.Union([Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')]);
const RiskRuleTierSchema = Type.Union([Type.Literal('high'), Type.Literal('medium')]);
export const RISK_QUESTION_COUNT = 7; // R3 "seven-question"
export const RISK_MAX_OPTIONS = 5; // bounds enumeration stays <= 5^7 combinations (R-6)
export const RISK_RESERVED_OPTION_VALUE = 'unknown'; // the UI always offers Unknown; no rubric option may take it
export const RiskOptionSchema = Type.Object(
  {
    value: Type.String({ pattern: '^[a-z][a-z0-9_]{0,39}$' }),
    label: BilingualSchema,
    level: RiskLevelSchema,
    escalatesTo: Type.Optional(RiskRuleTierSchema), // the tier is at least this when the option is chosen
  },
  { additionalProperties: false },
);
export const RiskQuestionSchema = Type.Object(
  {
    questionId: Type.String({ pattern: '^RQ[1-9]$' }),
    text: BilingualSchema,
    help: Type.Optional(BilingualSchema),
    evidenceSlot: Type.Optional(EvidenceSlotSchema), // R-5: the answer counts only when this slot is attached
    options: Type.Array(RiskOptionSchema, { minItems: 2, maxItems: RISK_MAX_OPTIONS }),
  },
  { additionalProperties: false },
);
export const RiskTierRuleSchema = Type.Object(
  {
    tier: RiskRuleTierSchema,
    anyOf: Type.Array(
      Type.Object(
        {
          allOf: Type.Array(
            Type.Object(
              {
                level: RiskRuleTierSchema, // counts answers of exactly this level
                atLeast: Type.Integer({ minimum: 1, maximum: RISK_QUESTION_COUNT }),
              },
              { additionalProperties: false },
            ),
            { minItems: 1 },
          ),
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
  },
  { additionalProperties: false },
);
export const RiskRubricBodySchema = Type.Object(
  {
    label: Type.String({ minLength: 1, maxLength: 100 }), // e.g. 'synthetic-placeholder.1'; never the recorded revision
    provenance: Type.Literal('synthetic_placeholder'), // R-2: the only value W5 accepts
    questions: Type.Array(RiskQuestionSchema, {
      minItems: RISK_QUESTION_COUNT,
      maxItems: RISK_QUESTION_COUNT,
    }), // order is display order
    tierRules: Type.Array(RiskTierRuleSchema), // first match wins; every high rule before any medium rule
    defaultTier: Type.Literal('low'),
    tierLabels: Type.Object(
      { high: BilingualSchema, medium: BilingualSchema, low: BilingualSchema, unknown: BilingualSchema },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type RiskRubricBody = Static<typeof RiskRubricBodySchema>;

/**
 * The checks a `risk_rubric` body needs beyond its schema (W5 plan section 2): unique question IDs, unique option
 * values within a question, the reserved option value `unknown`, and every `high` rule before any `medium` rule.
 * Returns problem strings; empty when the body is valid. Call only on a body that passed `RiskRubricBodySchema`.
 */
export function riskRubricBodyProblems(body: RiskRubricBody): string[] {
  const problems: string[] = [];
  const questionIds = new Set<string>();
  for (const question of body.questions) {
    const at = `/questions/${question.questionId}`;
    if (questionIds.has(question.questionId)) problems.push(`${at} is listed twice`);
    questionIds.add(question.questionId);
    const values = new Set<string>();
    for (const option of question.options) {
      if (option.value === RISK_RESERVED_OPTION_VALUE)
        problems.push(`${at}/options/${option.value} the option value unknown is reserved`);
      else if (values.has(option.value)) problems.push(`${at}/options/${option.value} is listed twice`);
      values.add(option.value);
    }
  }
  let seenMedium = false;
  body.tierRules.forEach((rule, index) => {
    if (rule.tier === 'medium') seenMedium = true;
    else if (seenMedium) problems.push(`/tierRules/${index} a high rule follows a medium rule`);
  });
  return problems;
}

export const CONFIGURATION_BODY_SCHEMAS = Object.freeze({
  checklist_templates: ChecklistTemplatesBodySchema,
  sla: SlaBodySchema,
  calendar: CalendarBodySchema,
  operator_recipients: OperatorRecipientsBodySchema,
  use_case_groups: UseCaseGroupsBodySchema,
  qc_rules: QcRulesBodySchema,
  risk_rubric: RiskRubricBodySchema, // W5-02; publishing also runs riskRubricBodyProblems
  desk_controls: DeskControlsBodySchema, // W6-02
}) satisfies Partial<Record<ConfigurationKind, unknown>>;

export type ConfigurationBodies = {
  checklist_templates: Static<typeof ChecklistTemplatesBodySchema>;
  sla: Static<typeof SlaBodySchema>;
  calendar: Static<typeof CalendarBodySchema>;
  operator_recipients: Static<typeof OperatorRecipientsBodySchema>;
  use_case_groups: Static<typeof UseCaseGroupsBodySchema>;
  qc_rules: Static<typeof QcRulesBodySchema>;
  risk_rubric: RiskRubricBody;
  desk_controls: Static<typeof DeskControlsBodySchema>; // W6-02
};
export type SeedableConfigurationKind = keyof ConfigurationBodies;

/**
 * W5-02 (W5 plan section 6): `GET /api/configuration/risk-rubric/current`, the `risk_rubric` revision in force now.
 * `provenance` is always 'synthetic_placeholder' in W5 (R-2): the seeded rubric is a placeholder for D07 (AI/COE).
 */
export interface RiskRubricView {
  revisionId: ConfigurationRevisionId;
  label: string;
  provenance: RiskRubricBody['provenance'];
  publishedAt: string;
  body: RiskRubricBody;
}
