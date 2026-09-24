// Finding rows with their disposition controls, the empty status, and the QC-unavailable block. The latest
// disposition of each finding comes from GET …/findings.

import type { JSX } from 'react';
import { isLocaleKey } from '@rai/shared/locales/keys';
import type { CaseView } from '@rai/shared/schemas/cases';
import type {
  DispositionKind,
  DispositionResponse,
  LaneQcRunResponse,
  StoredFindingSummary,
} from '@rai/shared/schemas/review';
import type { ExpectedVersion } from '@rai/shared/schemas/versions';
import type { SessionInfo } from '@rai/shared/schemas/auth';
import { Badge, type BadgeTone } from '../../components/status-badge.js';
import { useLocale } from '../../i18n/locale-provider.js';
import { DispositionControls } from './disposition-controls.js';
import {
  findingMessageParams,
  laneKey,
  qcUnavailableReasonKey,
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
  onDisposition: (response: DispositionResponse) => void;
  onUnauthenticated: (err: unknown) => boolean;
}

/** Render stored findings (from qc-run or GET …/findings) with disposition controls. */
export function FindingsList({
  findings,
  latestKinds,
  caseId,
  expectedVersion,
  session,
  view,
  onDisposition,
  onUnauthenticated,
}: FindingsListProps): JSX.Element {
  const { t } = useLocale();
  if (findings.length === 0) {
    return (
      <p className={'muted'} role={'status'} data-review-qc={'empty'}>
        {t('review.findings.empty')}
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
          onUnauthenticated={onUnauthenticated}
        />
      ))}
    </ul>
  );
}

export function QcUnavailableBlock({ run }: { run: LaneQcRunResponse }): JSX.Element {
  const { t } = useLocale();
  return (
    <div className={'review-qc-unavailable'} data-review-qc={'unavailable'} role={'status'}>
      <Badge status={'unavailable'} tone={'warn'} label={t('review.qc.unavailable_badge')} />
      <p>
        {t('review.qc.unavailable_body', {
          reason: t(qcUnavailableReasonKey(run.reason)),
        })}
      </p>
      {run.runId !== null ? (
        <p className={'muted small'}>{t('review.qc.run_id', { runId: run.runId })}</p>
      ) : null}
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
  onUnauthenticated,
}: {
  finding: StoredFindingSummary;
  latestKind: DispositionKind | null;
  caseId: string;
  expectedVersion: ExpectedVersion;
  session: SessionInfo;
  view: CaseView;
  onDisposition: (response: DispositionResponse) => void;
  onUnauthenticated: (err: unknown) => boolean;
}): JSX.Element {
  const { t } = useLocale();
  const message = isLocaleKey(finding.messageKey)
    ? t(finding.messageKey, findingMessageParams(finding))
    : finding.messageKey;
  return (
    <li className={'finding-row'} data-finding-id={finding.findingId}>
      <Badge
        status={finding.severity}
        tone={SEVERITY_TONE[finding.severity]}
        label={t(severityKey(finding.severity))}
      />
      <div className={'finding-body'}>
        <p className={'finding-message'}>{message}</p>
        <p className={'muted small finding-meta'}>
          {finding.slot === null
            ? t('review.findings.slot_none')
            : t('review.findings.slot', {
                number: finding.slot,
                name: t(slotNameKey(finding.slot)),
              })}
          {' · '}
          {t(laneKey(finding.owningLane))}
        </p>
        <DispositionControls
          caseId={caseId}
          finding={finding}
          expectedVersion={expectedVersion}
          session={session}
          view={view}
          latestKind={latestKind}
          onRecorded={onDisposition}
          onUnauthenticated={onUnauthenticated}
        />
      </div>
    </li>
  );
}
