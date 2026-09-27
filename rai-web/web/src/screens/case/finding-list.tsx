// Finding rows with their disposition controls, the empty status, and the QC-unavailable block. The latest
// disposition of each finding comes from GET …/findings. W4-12: a row also names its rule (label and ID), where its
// evidence points (slot and locator kind) and its owning lane; the unavailable block lists every unavailable run on
// the version, whatever its trigger; a lane run that evaluated 0 rules never reads as "no defects".

import type { JSX } from 'react';
import { isLocaleKey } from '@rai/shared/locales/keys';
import type { CaseView } from '@rai/shared/schemas/cases';
import type {
  DispositionKind,
  DispositionResponse,
  QcRunSummary,
  StoredFindingSummary,
} from '@rai/shared/schemas/review';
import type { ExpectedVersion } from '@rai/shared/schemas/versions';
import type { SessionInfo } from '@rai/shared/schemas/auth';
import { Badge, type BadgeTone } from '../../components/status-badge.js';
import { useLocale } from '../../i18n/locale-provider.js';
import { DispositionControls } from './disposition-controls.js';
import { useQcRunScope } from './qc-log.js';
import {
  evidenceLocations,
  evidenceLocatorKey,
  findingMessageParams,
  laneKey,
  qcUnavailableReasonKey,
  ruleLabelKey,
  severityKey,
  slotNameKey,
} from './view-model.js';

const SEVERITY_TONE: Readonly<Record<StoredFindingSummary['severity'], BadgeTone>> = {
  high: 'danger',
  medium: 'warn',
  low: 'info',
  info: 'neutral',
};

export interface FindingsListProps {
  findings: readonly StoredFindingSummary[];
  latestKinds: ReadonlyMap<string, DispositionKind | null>;
  caseId: string;
  expectedVersion: ExpectedVersion;
  session: SessionInfo;
  view: CaseView;
  /**
   * The status of an empty list: `empty` only when a lane-QC run was loaded and evaluated rules; `no_rules` when it
   * evaluated none (never a clean pass); `none_stored` when no run was loaded (see `laneRunEmptyStatus`).
   */
  emptyStatus: 'empty' | 'no_rules' | 'none_stored';
  onDisposition: (response: DispositionResponse) => void;
}

/** Render stored findings (from qc-run or GET …/findings) with disposition controls. */
export function FindingsList({
  findings,
  latestKinds,
  caseId,
  expectedVersion,
  session,
  view,
  emptyStatus,
  onDisposition,
}: FindingsListProps): JSX.Element {
  const { t } = useLocale();
  if (findings.length === 0) {
    // Stored findings alone say nothing about a QC result: the run they came from may have been unavailable.
    if (emptyStatus === 'no_rules') {
      return (
        <div className={'review-qc-no-rules'} role={'status'} data-review-qc={'no_rules'}>
          <Badge status={'qc-no_rules'} tone={'warn'} label={t('qc_log.outcome.no_rules')} />
          <p>{t('review.findings.no_rules')}</p>
        </div>
      );
    }
    return (
      <p className={'muted'} role={'status'} data-review-qc={emptyStatus}>
        {t(`review.findings.${emptyStatus}`)}
      </p>
    );
  }
  return (
    <ul className={'findings-list'} data-review-qc={'findings'} aria-label={t('review.findings.list_label')}>
      {findings.map((finding) => (
        <FindingRow
          key={finding.findingId}
          finding={finding}
          latestKind={latestKinds.get(finding.findingId) ?? null}
          caseId={caseId}
          expectedVersion={expectedVersion}
          session={session}
          view={view}
          onDisposition={onDisposition}
        />
      ))}
    </ul>
  );
}

/**
 * Every unavailable QC run on the version, whatever its trigger (W4a plan section 7), in one block before the
 * findings and the decision controls. None of them is a clean pass.
 */
export function QcUnavailableBlock({
  runs,
}: {
  runs: ReadonlyArray<Pick<QcRunSummary, 'runId' | 'trigger' | 'lane' | 'slot' | 'unavailableReason'>>;
}): JSX.Element {
  const { t } = useLocale();
  const scopeOf = useQcRunScope();
  return (
    <div className={'review-qc-unavailable'} data-review-qc={'unavailable'} role={'status'}>
      <Badge status={'unavailable'} tone={'warn'} label={t('review.qc.unavailable_badge')} />
      <ul className={'unavailable-run-list'} aria-label={t('review.qc.unavailable_runs_label')}>
        {runs.map((run) => (
          <li key={run.runId} data-unavailable-run-id={run.runId}>
            <strong>{scopeOf(run)}</strong>
            <p>
              {t('review.qc.unavailable_body', {
                reason: t(qcUnavailableReasonKey(run.unavailableReason ?? undefined)),
              })}
            </p>
            <p className={'muted small'}>{t('review.qc.run_id', { runId: run.runId })}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FindingRow({
  finding,
  latestKind,
  caseId,
  expectedVersion,
  session,
  view,
  onDisposition,
}: {
  finding: StoredFindingSummary;
  latestKind: DispositionKind | null;
  caseId: string;
  expectedVersion: ExpectedVersion;
  session: SessionInfo;
  view: CaseView;
  onDisposition: (response: DispositionResponse) => void;
}): JSX.Element {
  const { t } = useLocale();
  const message = isLocaleKey(finding.messageKey)
    ? t(finding.messageKey, findingMessageParams(finding))
    : finding.messageKey;
  const ruleLabel = ruleLabelKey(finding.ruleId);
  const locations = evidenceLocations(finding.evidence);
  return (
    <li className={'finding-row'} data-finding-id={finding.findingId}>
      <Badge
        status={finding.severity}
        tone={SEVERITY_TONE[finding.severity]}
        label={t(severityKey(finding.severity))}
      />
      <div className={'finding-body'}>
        <p className={'finding-message'}>{message}</p>
        <p className={'muted small finding-rule'} data-finding-rule={finding.ruleId}>
          {ruleLabel === null
            ? t('review.findings.rule_unlabelled', { id: finding.ruleId })
            : t('review.findings.rule', { label: t(ruleLabel), id: finding.ruleId })}
        </p>
        <p className={'muted small finding-meta'}>
          {finding.slot === null
            ? t('review.findings.slot_none')
            : t('review.findings.slot', {
                number: finding.slot,
                name: t(slotNameKey(finding.slot)),
              })}
          {' · '}
          <span data-finding-owning-lane={finding.owningLane}>
            {t('review.findings.owning_lane', { lane: t(laneKey(finding.owningLane)) })}
          </span>
        </p>
        <p className={'muted small finding-evidence'} data-finding-evidence={locations.length}>
          {locations.length === 0
            ? t('review.evidence.none')
            : t('review.evidence.label', {
                locations: locations
                  .map((location) =>
                    t('review.evidence.location', {
                      place:
                        location.slot === null
                          ? t('review.evidence.slot_none')
                          : t('review.evidence.slot', { number: location.slot }),
                      kind: t(evidenceLocatorKey(location.kind)),
                    }),
                  )
                  .join(', '),
              })}
        </p>
        <DispositionControls
          caseId={caseId}
          finding={finding}
          expectedVersion={expectedVersion}
          session={session}
          view={view}
          latestKind={latestKind}
          onRecorded={onDisposition}
        />
      </div>
    </li>
  );
}
