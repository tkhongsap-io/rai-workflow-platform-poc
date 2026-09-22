// Reviewer workspace (W2-07 / W2-09): on a current submitted version the owning-lane reviewer sees that lane's
// QC findings (from POST …/qc-run) above approve / send-back when the lane is still decidable, and disposition
// buttons on each finding. Controls wait for the run, including an unavailable run (still has a run id; zero
// findings → no disposition controls). Admin, owner/SPOC and wrong lane never draw decision or disposition
// controls the API would 403. Disposition kind overlay is in-session from the POST response (qc-run has no
// latest disposition). Issue #35 stays open for slot-5 / pack / unavailable owning-lane disposition.

import { useCallback, useEffect, useState, type JSX } from 'react';
import { isLocaleKey } from '@rai/shared/locales/keys';
import type { CaseView } from '@rai/shared/schemas/cases';
import type { Lane } from '@rai/shared/constants';
import type {
  DispositionKind,
  DispositionResponse,
  LaneDecisionResponse,
  LaneQcRunResponse,
  SendBackFeedback,
  StoredFindingSummary,
} from '@rai/shared/schemas/review';
import type { SubmittedVersion } from '@rai/shared/schemas/versions';
import type { SessionInfo } from '@rai/shared/schemas/auth';
import { api } from '../../api/client.js';
import { Badge, type BadgeTone } from '../../components/status-badge.js';
import { ErrorNotice } from '../../components/error-notice.js';
import { useLocale } from '../../i18n/locale-provider.js';
import { DispositionControls } from './disposition-controls.js';
import { SendBackDialog } from './send-back-dialog.js';
import {
  decidableLane,
  expectedVersionOf,
  findingMessageParams,
  findingsLane,
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

type QcResult = { kind: 'error'; error: unknown } | { kind: 'ready'; run: LaneQcRunResponse };
type QcState = { kind: 'loading' } | QcResult;

export interface ReviewerWorkspaceProps {
  caseId: string;
  version: SubmittedVersion;
  view: CaseView;
  hasOpenDraft: boolean;
  session: SessionInfo;
  onDecided: (response: LaneDecisionResponse) => void;
  onDispositionRecorded: (response: DispositionResponse) => void;
  onUnauthenticated: (err: unknown) => boolean;
}

export function ReviewerWorkspace(props: ReviewerWorkspaceProps): JSX.Element | null {
  const lane = findingsLane({
    roles: props.session.principal.roles,
    subjectId: props.session.principal.subjectId,
    view: props.view,
    version: props.version,
  });
  if (lane === null) return null;
  return <ReviewerWorkspaceBody {...props} lane={lane} />;
}

function ReviewerWorkspaceBody({
  caseId,
  version,
  view,
  hasOpenDraft,
  session,
  lane,
  onDecided,
  onDispositionRecorded,
  onUnauthenticated,
}: ReviewerWorkspaceProps & { lane: Lane }): JSX.Element {
  const { t } = useLocale();
  const qcKey = `${caseId}/${version.versionId}/${lane}`;
  const [qcStored, setQcStored] = useState<{ key: string; result: QcResult } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [busy, setBusy] = useState<'idle' | 'approving' | 'sending'>('idle');
  const [decisionError, setDecisionError] = useState<unknown>(null);
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [overlay, setOverlay] = useState<ReadonlyMap<string, DispositionKind>>(new Map());
  const expectedVersion = expectedVersionOf(version);
  const decideLane = decidableLane({
    roles: session.principal.roles,
    subjectId: session.principal.subjectId,
    view,
    version,
    hasOpenDraft,
  });
  const qc: QcState =
    qcStored !== null && qcStored.key === `${qcKey}#${reloadToken}` ? qcStored.result : { kind: 'loading' };

  useEffect(() => {
    let cancelled = false;
    const key = `${qcKey}#${reloadToken}`;
    void api
      .runLaneQc(caseId, version.versionId, lane, {
        expectedVersion: { versionId: version.versionId, revision: 1 },
      })
      .then((run) => {
        if (!cancelled) setQcStored({ key, result: { kind: 'ready', run } });
      })
      .catch((err: unknown) => {
        if (cancelled || onUnauthenticated(err)) return;
        setQcStored({ key, result: { kind: 'error', error: err } });
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, version.versionId, lane, qcKey, reloadToken, onUnauthenticated]);

  const approve = useCallback((): void => {
    const runId =
      qcStored !== null && qcStored.key === `${qcKey}#${reloadToken}` && qcStored.result.kind === 'ready'
        ? qcStored.result.run.runId
        : null;
    if (runId === null) return;
    setBusy('approving');
    setDecisionError(null);
    void api
      .approveLane(caseId, version.versionId, lane, { expectedVersion, qcRunId: runId }, crypto.randomUUID())
      .then((response) => {
        onDecided(response);
      })
      .catch((err: unknown) => {
        if (!onUnauthenticated(err)) setDecisionError(err);
      })
      .finally(() => {
        setBusy('idle');
      });
  }, [
    qcStored,
    qcKey,
    reloadToken,
    caseId,
    version.versionId,
    lane,
    expectedVersion,
    onDecided,
    onUnauthenticated,
  ]);

  const sendBack = useCallback(
    (feedback: SendBackFeedback): void => {
      setBusy('sending');
      setDecisionError(null);
      void api
        .sendBackLane(caseId, version.versionId, lane, { expectedVersion, feedback }, crypto.randomUUID())
        .then((response) => {
          setSendBackOpen(false);
          onDecided(response);
        })
        .catch((err: unknown) => {
          if (!onUnauthenticated(err)) setDecisionError(err);
        })
        .finally(() => {
          setBusy('idle');
        });
    },
    [caseId, version.versionId, lane, expectedVersion, onDecided, onUnauthenticated],
  );

  const onDisposition = useCallback(
    (response: DispositionResponse): void => {
      setOverlay((prev) => {
        const next = new Map(prev);
        next.set(response.findingId, response.kind);
        return next;
      });
      onDispositionRecorded(response);
    },
    [onDispositionRecorded],
  );

  return (
    <section className={'card reviewer-workspace'} aria-labelledby={'reviewer-findings-heading'}>
      <div className={'panel-head'}>
        <div>
          <h2 id={'reviewer-findings-heading'}>{t('review.findings.heading', { lane: t(laneKey(lane)) })}</h2>
          <p className={'muted'}>{t('review.findings.intro')}</p>
        </div>
      </div>

      {qc.kind === 'loading' ? (
        <p className={'muted'} role={'status'} data-review-qc={'loading'}>
          {t('review.findings.loading')}
        </p>
      ) : null}

      {qc.kind === 'error' ? (
        <ErrorNotice error={qc.error}>
          <button
            type={'button'}
            className={'btn btn-secondary'}
            onClick={() => {
              setReloadToken((n) => n + 1);
            }}
          >
            {t('action.reload')}
          </button>
        </ErrorNotice>
      ) : null}

      {qc.kind === 'ready' ? (
        <>
          <FindingsBlock
            run={qc.run}
            overlay={overlay}
            caseId={caseId}
            expectedVersion={expectedVersion}
            session={session}
            view={view}
            onDisposition={onDisposition}
            onUnauthenticated={onUnauthenticated}
          />
          {decideLane !== null ? (
            <div className={'reviewer-actions'} data-review-controls={'ready'}>
              {decisionError !== null ? (
                <ErrorNotice error={decisionError}>
                  <button
                    type={'button'}
                    className={'btn btn-ghost'}
                    onClick={() => {
                      setDecisionError(null);
                    }}
                  >
                    {t('action.dismiss')}
                  </button>
                </ErrorNotice>
              ) : null}
              <button
                type={'button'}
                className={'btn btn-secondary'}
                disabled={busy !== 'idle' || qc.run.runId === null}
                onClick={() => {
                  setSendBackOpen(true);
                }}
              >
                {t('review.action.send_back')}
              </button>
              <button
                type={'button'}
                className={'btn btn-primary'}
                disabled={busy !== 'idle' || qc.run.runId === null}
                onClick={approve}
              >
                {busy === 'approving' ? t('review.action.approving') : t('review.action.approve')}
              </button>
            </div>
          ) : null}
          {decideLane !== null ? (
            <SendBackDialog
              open={sendBackOpen}
              busy={busy === 'sending'}
              onClose={() => {
                setSendBackOpen(false);
              }}
              onSubmit={sendBack}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function FindingsBlock({
  run,
  overlay,
  caseId,
  expectedVersion,
  session,
  view,
  onDisposition,
  onUnauthenticated,
}: {
  run: LaneQcRunResponse;
  overlay: ReadonlyMap<string, DispositionKind>;
  caseId: string;
  expectedVersion: ReturnType<typeof expectedVersionOf>;
  session: SessionInfo;
  view: CaseView;
  onDisposition: (response: DispositionResponse) => void;
  onUnauthenticated: (err: unknown) => boolean;
}): JSX.Element {
  const { t } = useLocale();
  if (run.status === 'unavailable') {
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
  if (run.findings.length === 0) {
    return (
      <p className={'muted'} role={'status'} data-review-qc={'empty'}>
        {t('review.findings.empty')}
      </p>
    );
  }
  return (
    <ul className={'findings-list'} data-review-qc={'findings'} aria-label={t('review.findings.list_label')}>
      {run.findings.map((finding) => (
        <FindingRow
          key={finding.findingId}
          finding={finding}
          latestKind={overlay.get(finding.findingId) ?? null}
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
  expectedVersion: ReturnType<typeof expectedVersionOf>;
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
          canSeeFindings={true}
          onRecorded={onDisposition}
          onUnauthenticated={onUnauthenticated}
        />
      </div>
    </li>
  );
}
