# Specification

Source: W5 plan section 9 (the W5-04 row), section 2 (fail-closed rows for a draft save), section 4 ("Draft answers"), section 6 (`PackDraft`, `PackDraftUpdateRequest`) and section 12 (W0-02 7.5 gains `riskAnswers`, W5-04). The plan wins over issue #222.

Done when:

1. **Shapes** (`shared/src/schemas/pack.ts`):
   - `RiskAnswerSchema = { value: string; answeredBy: SubjectId; answeredByName?: string; answeredRole: Role; answeredAt: string }`; `value` is an option value or `'unknown'`.
   - `PackDraft.riskAnswers: Record<RiskQuestionId, RiskAnswer>` (required; `{}` when nothing is answered). `RiskQuestionId` matches `^RQ[1-9]$` (the rubric schema's pattern).
   - `PackDraftUpdateRequest.riskAnswers?: Record<RiskQuestionId, string | null>`, `additionalProperties: false`, at most 20 keys; a value matches the option-value pattern `^[a-z][a-z0-9_]{0,39}$` (which `unknown` satisfies). A malformed key or value is a shape failure (422 `invalid_input`, path under `body.riskAnswers`).
2. **Validation** (`pack/service.ts` `validateValues`, step 4, collected into the one 422 with the other field errors), against the `risk_rubric` revision in force at the save's `now` (W1-00 activation rule):
   - a non-null answer when no rubric is in force: 422 `error.risk.not_configured` at `body.riskAnswers` (one error);
   - a question ID not in the rubric, or a value that is neither one of that question's options nor `unknown`: 422 `validation.not_in_configured_list` at `body.riskAnswers.<questionId>`;
   - `null` (clear) is always accepted, with or without a rubric and for any question ID the pattern allows, so an answer left over from an earlier rubric can always be cleared;
   - a rejected save writes nothing (no answer, no revision bump, no audit).
3. **Storage** (`pack/repository.ts` `updateDraftRiskAnswers(tx, versionId, merged)`): the request is merged into the draft's stored answers. A new or changed value is stored as `{ value, answeredBy: actor subjectId, answeredRole: acting role, answeredAt: now ISO }`; a value equal to the stored one keeps its original attribution; `null` removes the key. The stored object holds no name and no text.
4. **Read** (`packDraftView`, GET and PUT responses): `riskAnswers` from the stored column; `answeredByName` added when the subject directory resolves the subject (W3-F1 pattern), omitted otherwise. Names are display only.
5. **Audit** (`draft.saved`): `changed_fields` gains `risk_answers` when the merged answers differ from the stored ones; `targetRef.risk_answers = [{ question_id, value }]` lists every answer the request carried, in question-ID order, `value` `null` for a clear. Present only when the request carried `riskAnswers`, so every existing `draft.saved` shape is unchanged. Values are enumerations, never text; no attribution or name enters the audit ref.
6. **Successor copy** (`workflow/repository.ts` `ensureSuccessorDraft`): the new draft N+1 copies `risk_answers` from the parent, attribution included; a reused open draft is untouched.
7. **Freeze**: no code change; the W5-03 trigger already freezes the column. A test proves a submitted version's answers cannot be changed through the draft route (409, the draft is gone) and the row still holds them.
8. **Substitute** (`fixtures/src/substitutes/api/store.ts`, `workflow.ts` `PackDraft` literals only): `riskAnswers: {}`; typecheck green. The substitute does not store answers (W5-07 adds its rubric read).
9. **Locale**: `error.risk.not_configured` in `th.json` and `en.json` (the error's message key must be a `LocaleKey`).
10. **Tests**: new `tests/integration/w5-04-risk-answers.test.ts` (save, clear, attribution kept and replaced, audit refs, every 422 path, not-configured, reviewer and Admin 403, freeze); `tests/integration/w2-03-successor-draft.test.ts` extended (successor copies the parent's answers and attribution); a unit test for the pure merge and validation helpers.
11. **W0-02 amendment**: section 7.5 gains a dated W5-04 note (`riskAnswers` on both shapes and the two 422 rows).
12. Full W5 plan section 10 gate green. No migration, no scoring, no UI, no new route.
