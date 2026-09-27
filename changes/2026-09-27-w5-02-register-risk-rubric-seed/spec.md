# Specification

Source: W5 plan section 9 (the W5-02 row), section 3 ("Placeholder seed"), section 2 (publish refusals), section 6 (the `GET /api/configuration/risk-rubric/current` row) and section 12 (W0-02 section 7 gains the endpoint, W5-02). The plan wins over issue #213.

Done when:

1. **Registered kind** (`shared/src/schemas/cases.ts`): `CONFIGURATION_BODY_SCHEMAS.risk_rubric = RiskRubricBodySchema` and `ConfigurationBodies.risk_rubric = RiskRubricBody`, so `risk_rubric` is a `SeedableConfigurationKind`. A `RiskRubricView` response type: `{ revisionId, label, provenance, publishedAt, body }`.
2. **Validated on publish** (`server/src/configuration/store.ts` `validateConfigurationBody`): one `if (kind === 'risk_rubric')` branch running `riskRubricBodyProblems` after the schema, like `qc_rules`. A body failing the schema or with a problem throws `ConfigurationBodyInvalid`; nothing is written and no audit event is appended.
3. **Placeholder seed** (`server/src/configuration/seed.ts`, kind `risk_rubric`, revision 1):
   - `label: 'synthetic-placeholder.1'`, `provenance: 'synthetic_placeholder'`.
   - Seven invented questions `RQ1`..`RQ7` in this order: people affected, automation of decisions, personal data, external exposure, vendor or model provenance, reversibility, monitoring. Every question text starts with `[SYNTHETIC PLACEHOLDER]` in both `th` and `en`.
   - Three options each (levels low, medium, high); on the personal-data question the option `yes` has `escalatesTo: 'medium'` (never `high`).
   - `evidenceSlot: 1` on every question.
   - `tierRules`: High at >= 3 high answers; Medium at >= 1 high or >= 2 medium; `defaultTier: 'low'`.
   - `tierLabels` High, Medium, Low, Unknown with Thai equivalents.
   - The file header says every value is a placeholder for D07 (AI/COE), not derived from the approved questionnaire.
4. **Rubric read** (`GET /api/configuration/risk-rubric/current`, in `server/src/cases/routes.ts` next to `GET /api/configuration/current`): action `config.read_effective` (every role), target none. 200 `RiskRubricView` of the `risk_rubric` revision in force at the server's `now` under the W1-00 activation rule (published strictly before now). 404 `not_found` with `details.resource = 'risk_rubric'` when none is in force (`NotFoundResource` gains `risk_rubric`). 401 without a session.
5. **Tests**:
   - `seed.test.ts`: the by-kind list gains `risk_rubric`; the placeholder's values (spec item 3); the placeholder validates; the thresholds differ from the section 7 summary (personal data does not escalate to High; two high answers are not High); "no body schema" is proven on a kind that still has none (`group_role_mapping`); a risk rubric body with a problem is refused.
   - `rubric-schema.test.ts`: the W5-01 "not yet registered" assertion becomes "registered" (the behaviour change this ticket makes).
   - `w1-00-configuration.test.ts`: the "no body schema" publish refusal uses `group_role_mapping`; an invalid `risk_rubric` body is refused on publish with nothing written; the seed publishes the placeholder (via the existing per-kind loop).
   - `w1-05-submit` passes unchanged: the freeze records `risk_rubric` in `frozen_configuration` and `configuration_revision_id` stays the `qc_rules` revision (an explicit assertion added).
   - New `tests/integration/w5-02-risk-rubric.test.ts`: 200 with the seeded revision for every role; 401 without a session; 404 `risk_rubric` when no revision is in force; a later revision applies only after its publish instant.
6. **W0-02 amendment**: section 7.3 gains a dated W5-02 note and the endpoint row.
7. Full W5 plan section 10 gate green. No migration, no scoring, no answers, no UI, no substitute route (W5-07 adds the substitute's rubric read).
