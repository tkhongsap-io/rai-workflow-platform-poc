// Lane decisions as the version read serves them, each send-back with the slots its feedback names. The frozen
// version lists all of its decisions; the successor draft lists its parent's send-backs, so the owner sees what to
// fix while editing. Reviewer identities render as the subject id, the way the version shows submittedBy.

import { useId, type JSX } from 'react';
import type { LocaleKey } from '@rai/shared/locales/keys';
import type { LaneDecision, LaneDecisionKind } from '@rai/shared/schemas/review';
import { formatDateTime } from '../../i18n/format.js';
import { useLocale } from '../../i18n/locale-provider.js';
import { laneKey, slotNameKey } from './view-model.js';

const DECISION_KEY: Readonly<Record<LaneDecisionKind, LocaleKey>> = {
  approve: 'projection.approved',
  send_back: 'projection.sent_back',
};

export function LaneDecisions({
  heading,
  decisions,
}: {
  heading: string;
  decisions: readonly LaneDecision[];
}): JSX.Element | null {
  const { t, locale } = useLocale();
  const headingId = useId();
  if (decisions.length === 0) return null;
  return (
    <section className={'card'} aria-labelledby={headingId}>
      <h2 id={headingId}>{heading}</h2>
      <ul className={'decision-list'}>
        {decisions.map((decision) => (
          <li key={`${decision.lane}-${decision.decidedAt}`} className={'decision-row'}>
            <p className={'decision-head'}>
              <strong>{t(laneKey(decision.lane))}</strong>
              {' · '}
              {t(DECISION_KEY[decision.decision])}
            </p>
            <p className={'muted small'}>
              {t('version.decisions.decided_by', {
                subject: decision.decidedByDisplayName ?? decision.decidedBy,
              })}
              {' · '}
              <time dateTime={decision.decidedAt}>{formatDateTime(locale, decision.decidedAt)}</time>
            </p>
            {decision.feedback !== null ? (
              <>
                <ul className={'feedback-list'}>
                  {decision.feedback.items.map((item, index) => (
                    <li key={index}>
                      <strong>
                        {t('review.send_back.slot_option', {
                          number: item.slot,
                          name: t(slotNameKey(item.slot)),
                        })}
                      </strong>
                      <p className={'feedback-text'}>{item.deficiency}</p>
                    </li>
                  ))}
                </ul>
                {decision.feedback.summary !== undefined ? (
                  <p className={'feedback-text'}>
                    <strong>{t('version.feedback.summary')}</strong> {decision.feedback.summary}
                  </p>
                ) : null}
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
