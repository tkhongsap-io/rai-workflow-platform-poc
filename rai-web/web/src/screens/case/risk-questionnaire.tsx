// W5-07 (W5 plan section 7, "Pack editor"): the risk questionnaire on the pack draft. One fieldset/legend radio group
// per rubric question (native radios: arrow keys move within a group, Tab between groups), each with the rubric's
// options plus "Unknown / not yet known" and a clear button; the evidence hint names the cited slot and its current
// state; a saved answer shows who gave it. Changes are held with the pending pack settings and sent by "Save draft".
// The live preview runs the shared engine and is labelled as a preview: only the submit records a proposal (R-4).
// The rubric read is optional (R-16): a 404 shows one "not configured" line, any other failure one "unavailable"
// line, and neither disables save, submit or any slot control. Rubric text is Admin-owned bilingual body text (D12).

import { useEffect, useState, type JSX } from 'react';
import type { LocaleKey } from '@rai/shared/locales/keys';
import type { RiskScore } from '@rai/shared/risk/types';
import type { RiskRubricView } from '@rai/shared/schemas/cases';
import type { PackDraft, SlotNumber, SlotState } from '@rai/shared/schemas/pack';
import { api } from '../../api/client.js';
import { PlaceholderRubricBanner } from '../../components/placeholder-rubric-banner.js';
import { Badge, type BadgeTone } from '../../components/status-badge.js';
import { formatDateTime } from '../../i18n/format.js';
import { useLocale } from '../../i18n/locale-provider.js';
import {
  applyRiskAnswerChange,
  councilNoticeOf,
  effectiveRiskAnswers,
  previewRiskScore,
  riskAnswerChoices,
  riskTierLabel,
  rubricStateFromError,
  rubricStateFromValue,
  type PendingRiskAnswers,
  type RubricState,
} from './risk-questionnaire.view-model.js';
import { slotNameKey, slotStateKey } from './view-model.js';

export interface RiskQuestionnaireProps {
  draft: PackDraft;
  /** The editor's slots with pending changes applied: the preview and the evidence hint read these. */
  slots: Readonly<Record<SlotNumber, SlotState>>;
  pending: PendingRiskAnswers | undefined;
  /** The actor is a case writer (owner or BU SPOC); anyone else reads the answers. */
  canEdit: boolean;
  /** Saving or submitting. */
  disabled: boolean;
  /** Question ID → translated field error from the last save. */
  fieldErrors: ReadonlyMap<string, string>;
  onChange: (next: PendingRiskAnswers) => void;
}

/** Glyph and tone per tier, so the tier never reads by colour alone; Unknown is never styled as Low. */
const TIER_TONE: Readonly<Record<RiskScore['tier'], BadgeTone>> = Object.freeze({
  high: 'danger',
  medium: 'warn',
  low: 'ok',
  unknown: 'muted',
});

/** Reads the rubric in force once per mounted editor. */
function useRiskRubric(): RubricState {
  const [state, setState] = useState<RubricState>({ kind: 'loading' });
  useEffect(() => {
    let cancelled = false;
    void api
      .getRiskRubric()
      .then((view) => {
        if (!cancelled) setState(rubricStateFromValue(view));
      })
      .catch((err: unknown) => {
        if (!cancelled) setState(rubricStateFromError(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

export function RiskQuestionnaire(props: RiskQuestionnaireProps): JSX.Element {
  const { t } = useLocale();
  const state = useRiskRubric();
  return (
    <section
      className={'risk-questionnaire'}
      aria-labelledby={'risk-heading'}
      data-risk-questionnaire={state.kind}
    >
      <h3 id={'risk-heading'}>{t('risk.questionnaire.heading')}</h3>
      {state.kind === 'loading' ? <p className={'muted'}>{t('common.loading')}</p> : null}
      {state.kind === 'not_configured' ? (
        <p className={'muted'}>{t('risk.questionnaire.not_configured')}</p>
      ) : null}
      {state.kind === 'unavailable' ? <p className={'muted'}>{t('risk.questionnaire.unavailable')}</p> : null}
      {state.kind === 'ready' ? <RubricForm {...props} rubric={state.rubric} /> : null}
    </section>
  );
}

function RubricForm(props: RiskQuestionnaireProps & { rubric: RiskRubricView }): JSX.Element {
  const { t, locale } = useLocale();
  const { rubric, draft, pending, canEdit, disabled } = props;
  const body = rubric.body;
  const saved = draft.riskAnswers;
  const effective = effectiveRiskAnswers(saved, pending);
  const score = previewRiskScore(body, effective, props.slots);
  const council = councilNoticeOf(score);
  const tierText = (tier: RiskScore['tier']): string => riskTierLabel(body, tier, locale, t);
  const change = (questionId: string, value: string | null): void => {
    props.onChange(applyRiskAnswerChange(saved, pending, questionId, value));
  };

  return (
    <>
      <PlaceholderRubricBanner provenance={rubric.provenance} />
      <p className={'muted'}>{t('risk.questionnaire.intro')}</p>
      <p className={'muted small'}>
        {t('risk.questionnaire.rubric_label', { label: rubric.label, revisionId: rubric.revisionId })}
      </p>

      {body.questions.map((question, index) => {
        const id = question.questionId;
        const current = Object.hasOwn(effective, id) ? effective[id] : undefined;
        const savedAnswer = Object.hasOwn(saved, id) ? saved[id] : undefined;
        const isPending = pending !== undefined && Object.hasOwn(pending, id);
        const hintId = `risk-${id}-hint`;
        const error = props.fieldErrors.get(id);
        const evidenceSlot = question.evidenceSlot;
        return (
          <fieldset
            key={id}
            className={'risk-question'}
            data-risk-question={id}
            aria-describedby={hintId}
            disabled={!canEdit || disabled}
          >
            <legend>{question.text[locale]}</legend>
            <div id={hintId}>
              {question.help !== undefined ? <p className={'field-hint'}>{question.help[locale]}</p> : null}
              {evidenceSlot !== undefined ? (
                <p className={'field-hint'} data-risk-evidence={props.slots[evidenceSlot].state}>
                  {t('risk.evidence.hint', {
                    slot: evidenceSlot,
                    name: t(slotNameKey(evidenceSlot)),
                    state: t(slotStateKey(props.slots[evidenceSlot].state)),
                  })}
                </p>
              ) : null}
            </div>
            <div className={'risk-choices'}>
              {riskAnswerChoices(question).map((choice) => (
                <label key={choice.value} className={'choice'}>
                  <input
                    type={'radio'}
                    name={`risk-${id}`}
                    value={choice.value}
                    checked={current === choice.value}
                    onChange={() => change(id, choice.value)}
                  />
                  <span>{choice.label === null ? t('risk.answer.unknown') : choice.label[locale]}</span>
                </label>
              ))}
            </div>
            <div className={'risk-question-foot'}>
              <span className={'muted small'} data-risk-attribution={isPending ? 'pending' : 'saved'}>
                {isPending
                  ? t('risk.answer.unsaved')
                  : savedAnswer !== undefined
                    ? t('risk.answered_by', {
                        name: savedAnswer.answeredByName ?? savedAnswer.answeredBy,
                        role: t(`role.${savedAnswer.answeredRole}` as LocaleKey),
                        at: formatDateTime(locale, savedAnswer.answeredAt),
                      })
                    : null}
              </span>
              {canEdit ? (
                <button
                  type={'button'}
                  className={'btn btn-ghost btn-small'}
                  aria-label={t('risk.answer.clear_label', { number: index + 1 })}
                  disabled={current === undefined}
                  onClick={() => change(id, null)}
                >
                  {t('risk.answer.clear')}
                </button>
              ) : null}
            </div>
            {error !== undefined ? <p className={'field-error'}>{error}</p> : null}
          </fieldset>
        );
      })}

      <div className={'notice risk-preview'} aria-live={'polite'} data-risk-preview={score.tier}>
        <p>
          <strong>{t('risk.preview.label')}</strong>
        </p>
        <p className={'risk-preview-tier'}>
          <span>{t('risk.preview.tier')}</span>{' '}
          <Badge status={score.tier} tone={TIER_TONE[score.tier]} label={tierText(score.tier)} />
        </p>
        {score.tier === 'unknown' ? (
          <p>
            {t('risk.unknown.range', {
              count: score.unknownCount,
              lowest: tierText(score.bounds.lowest),
              highest: tierText(score.bounds.highest),
            })}
          </p>
        ) : null}
        {council !== null ? (
          <p data-risk-council={council}>
            {t(council === 'required' ? 'risk.council.required' : 'risk.council.possible')}
          </p>
        ) : null}
      </div>
    </>
  );
}
