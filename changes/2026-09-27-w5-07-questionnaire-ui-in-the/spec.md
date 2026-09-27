# Spec: questionnaire UI in the pack editor (W5-07, #230)

Source: [W5 plan](../../docs/engineering/implementation-plan-w5.md) section 7 and the W5-07 row of section 9. The plan wins over issue #230.

## API client (`web/src/api/client.ts`)

- `API_PATHS.riskRubric = '/api/configuration/risk-rubric/current'`.
- `api.getRiskRubric(): Promise<RiskRubricView | null>`: the W5-02 view, or `null` when the route answers 404 (none in force, or a server or substitute without the route). Every other failure throws as today.

## View model (`web/src/screens/case/risk-questionnaire.view-model.ts`, new, unit-tested)

- `RubricState`: `loading` | `ready` (the view) | `not_configured` (404) | `unavailable` (any other error). `rubricStateFromValue(view)` maps the client's answer (`null` → `not_configured`) and `rubricStateFromError(err)` maps a thrown failure (404 → `not_configured`, anything else → `unavailable`).
- Pending answers live with the pending settings (`PendingSettings.riskAnswers`): question ID → option value, `'unknown'` or `null` (clear). `applyRiskAnswerChange` drops a pending entry that equals the saved value; `effectiveRiskAnswers` merges saved and pending; `riskPendingCount` counts changed answers, so the unsaved-change count and "save before submit" rule include them.
- `previewRiskScore(body, effective, slots)` runs `scoreRisk` from `@rai/shared/risk/score` over the effective answers and the editor's current (pending-merged) slot states.
- `riskTierLabel(body, tier, locale, t)`: the rubric's `tierLabels` win; the `risk.tier.*` keys are the fallback.
- `riskQuestionOfFieldPath(path)`: `body.riskAnswers.RQn` → `RQn` for an inline field error.

## Components

- `web/src/components/placeholder-rubric-banner.tsx`: `role="note"`, shown when `provenance === 'synthetic_placeholder'`, text `risk.placeholder.banner`.
- `web/src/screens/case/risk-questionnaire.tsx`, mounted in `pack-editor.tsx` below the slot table:
  - heading `risk.questionnaire.heading`; the banner; the rubric label;
  - one `fieldset`/`legend` per question in rubric order (`data-risk-question`), native radios for each option plus `risk.answer.unknown`, and a `risk.answer.clear` button (disabled when nothing is chosen);
  - the evidence hint `risk.evidence.hint` naming the slot and its current state; the fieldset's `aria-describedby` points at the hint only when the question has help text or an evidence slot (round 1); the saved answer's attribution (`risk.answered_by`), or `risk.answer.unsaved` when changed;
  - the live preview (`aria-live="polite"`, not `role="status"`, so the editor's save notice stays the one status; `risk.preview.label`) with the tier as text plus glyph, the range when `unknown` (`risk.unknown.range`), and the Council line when the tier is High (`risk.council.required`) or could be (`risk.council.possible`);
  - read-only (disabled radios, no clear) for anyone but a case writer, and while saving or submitting;
  - `not_configured`: one muted line `risk.questionnaire.not_configured`; `unavailable`: one muted line `risk.questionnaire.unavailable`. Neither is an error banner, neither disables save, submit or slot changes.
- `pack-editor.tsx` counts pending answers in the unsaved count; `case-screen.tsx` `onSave` sends `riskAnswers` in the one `PackDraftUpdateRequest`.

## Substitute (`fixtures/src/substitutes/api/routes-cases.ts`)

- `GET /api/configuration/risk-rubric/current` (`config.read_effective`) answers `200` with `CONFIGURATION_SEED.risk_rubric` as a `RiskRubricView` (fixed synthetic revision ID, the fixture configuration's `publishedAt`). The substitute still stores no answers (W5-04); that drift is listed in its README.

## Locale keys (th and en)

`risk.questionnaire.heading`, `risk.questionnaire.intro`, `risk.questionnaire.not_configured`, `risk.questionnaire.unavailable`, `risk.questionnaire.rubric_label`, `risk.placeholder.banner`, `risk.answer.unknown`, `risk.answer.clear`, `risk.answer.clear_label`, `risk.answer.unsaved`, `risk.answered_by`, `risk.evidence.hint`, `risk.preview.label`, `risk.preview.tier`, `risk.tier.{high,medium,low,unknown}`, `risk.unknown.range`, `risk.council.required`, `risk.council.possible`.

## Acceptance (W5-07 row)

- Unit: the view model, including the 404 "not configured" path; the client's 404 → `null`; the substitute's rubric read.
- Browser `tests/browser/w5-07-risk-questionnaire.spec.ts` on the real server: answer, clear, preview, banner; th and en; axe at the three widths; keyboard-only answering; the 404 path keeps save and submit usable.
- Every existing `test:browser:substitute` journey still passes.
