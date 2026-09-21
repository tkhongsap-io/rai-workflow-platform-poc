// The case overview header (design handoff: case identity, submission version and next action prominent;
// status as text plus colour). Renders the W0-02 7.3 CaseView fields as the API returned them, including the
// four projected status fields the workflow writes (read-only here). `sourceRecordId` shows the known value
// unchanged or the literal Unknown (L10); it is never looked up.

import type { JSX } from 'react';
import type { CaseView, LaneProjectionStatus, ReadinessProjectionStatus } from '@rai/shared/schemas/cases';
import { useLocale, useT } from './locale.js';
import { StatusBadge, type BadgeTone } from './status-badge.js';
import { formatDateTime, modelTypeKey, nextActionKey, statusKey, submissionLine } from './view-model.js';

const STATUS_TONE: Readonly<Record<CaseView['status'], BadgeTone>> = {
  draft: 'neutral',
  in_review: 'warn',
  sent_back: 'danger',
  awaiting_disposition: 'warn',
  ready_for_launch: 'ok',
};

const PROJECTION_TONE: Readonly<Record<LaneProjectionStatus, BadgeTone>> = {
  pending: 'neutral',
  approved: 'ok',
  sent_back: 'danger',
};

const READINESS_TONE: Readonly<Record<ReadinessProjectionStatus, BadgeTone>> = {
  not_ready: 'neutral',
  ready: 'ok',
};

export function CaseOverview({ view }: { view: CaseView }): JSX.Element {
  const t = useT();
  const locale = useLocale();
  const submission = submissionLine(view);
  const source =
    view.sourceRecordId.kind === 'known' ? view.sourceRecordId.value : t('case.field.source_record_unknown');
  return (
    <header className="rai-case-head">
      <div className="rai-case-head__top">
        <div className="rai-case-head__identity">
          <p className="rai-case-head__meta">
            <span className="rai-case-head__registry">{view.registryId}</span>
            <span aria-hidden="true">·</span>
            <span>{t(submission.key, submission.params)}</span>
          </p>
          <h1 className="rai-case-head__title">{view.useCaseName}</h1>
        </div>
        <div className="rai-case-head__status">
          <span className="rai-label">{t('case.status_label')}</span>
          <StatusBadge
            status={view.status}
            tone={STATUS_TONE[view.status]}
            label={t(statusKey(view.status))}
          />
        </div>
      </div>

      <p className="rai-case-head__next">
        <span className="rai-label">{t('case.next_action.label')}</span> {t(nextActionKey(view.status))}
      </p>

      <dl className="rai-facts">
        <div>
          <dt>{t('case.field.business_unit')}</dt>
          <dd>
            {view.businessUnit} ({view.businessUnitId})
          </dd>
        </div>
        <div>
          <dt>{t('case.field.business_owner')}</dt>
          <dd>{view.businessOwner}</dd>
        </div>
        <div>
          <dt>{t('case.field.technical_owner')}</dt>
          <dd>{view.technicalOwner}</dd>
        </div>
        <div>
          <dt>{t('case.field.source_record_id')}</dt>
          <dd>{source}</dd>
        </div>
        <div>
          <dt>{t('case.field.use_case_group')}</dt>
          <dd>{view.useCaseGroup}</dd>
        </div>
        <div>
          <dt>{t('case.field.vendor_involved')}</dt>
          <dd>{view.vendorInvolved ? t('common.yes') : t('common.no')}</dd>
        </div>
        <div>
          <dt>{t('case.field.model_type')}</dt>
          <dd>{t(modelTypeKey(view.modelType))}</dd>
        </div>
        <div>
          <dt>{t('case.field.updated_at')}</dt>
          <dd>
            <time dateTime={view.updatedAt}>{formatDateTime(locale, view.updatedAt)}</time>
          </dd>
        </div>
      </dl>

      <div className="rai-lanes" aria-label={t('case.lane_status.heading')} role="group">
        <span className="rai-label">{t('case.lane_status.heading')}</span>
        <span className="rai-lanes__item">
          {t('case.lane.rai')}{' '}
          <StatusBadge
            status={view.raiStatus}
            tone={PROJECTION_TONE[view.raiStatus]}
            label={t(`projection.${view.raiStatus}`)}
          />
        </span>
        <span className="rai-lanes__item">
          {t('case.lane.privacy')}{' '}
          <StatusBadge
            status={view.privacyStatus}
            tone={PROJECTION_TONE[view.privacyStatus]}
            label={t(`projection.${view.privacyStatus}`)}
          />
        </span>
        <span className="rai-lanes__item">
          {t('case.lane.security')}{' '}
          <StatusBadge
            status={view.securityStatus}
            tone={PROJECTION_TONE[view.securityStatus]}
            label={t(`projection.${view.securityStatus}`)}
          />
        </span>
        <span className="rai-lanes__item">
          {t('case.lane.readiness')}{' '}
          <StatusBadge
            status={view.aiReadinessStatus}
            tone={READINESS_TONE[view.aiReadinessStatus]}
            label={t(`readiness.${view.aiReadinessStatus}`)}
          />
        </span>
      </div>
    </header>
  );
}
