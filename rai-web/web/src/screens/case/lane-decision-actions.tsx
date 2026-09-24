// Approve and send-back for one lane; the workspace shows them only while laneIsDecidable holds.

import { useCallback, useState, type JSX } from 'react';
import type { Lane } from '@rai/shared/constants';
import type { LaneDecisionResponse, SendBackFeedback } from '@rai/shared/schemas/review';
import type { ExpectedVersion } from '@rai/shared/schemas/versions';
import { api } from '../../api/client.js';
import { ErrorNotice } from '../../components/error-notice.js';
import { useLocale } from '../../i18n/locale-provider.js';
import { SendBackDialog } from './send-back-dialog.js';

export interface LaneDecisionActionsProps {
  caseId: string;
  versionId: string;
  lane: Lane;
  expectedVersion: ExpectedVersion;
  qcRunId: string | null;
  onDecided: (response: LaneDecisionResponse) => void;
}

export function LaneDecisionActions({
  caseId,
  versionId,
  lane,
  expectedVersion,
  qcRunId,
  onDecided,
}: LaneDecisionActionsProps): JSX.Element {
  const { t } = useLocale();
  const [busy, setBusy] = useState<'idle' | 'approving' | 'sending'>('idle');
  const [decisionError, setDecisionError] = useState<unknown>(null);
  const [sendBackOpen, setSendBackOpen] = useState(false);

  const approve = useCallback((): void => {
    if (qcRunId === null) return;
    setBusy('approving');
    setDecisionError(null);
    void api
      .approveLane(caseId, versionId, lane, { expectedVersion, qcRunId }, crypto.randomUUID())
      .then((response) => {
        onDecided(response);
      })
      .catch((err: unknown) => {
        setDecisionError(err);
      })
      .finally(() => {
        setBusy('idle');
      });
  }, [qcRunId, caseId, versionId, lane, expectedVersion, onDecided]);

  const sendBack = useCallback(
    (feedback: SendBackFeedback): void => {
      setBusy('sending');
      setDecisionError(null);
      void api
        .sendBackLane(caseId, versionId, lane, { expectedVersion, feedback }, crypto.randomUUID())
        .then((response) => {
          setSendBackOpen(false);
          onDecided(response);
        })
        .catch((err: unknown) => {
          setDecisionError(err);
        })
        .finally(() => {
          setBusy('idle');
        });
    },
    [caseId, versionId, lane, expectedVersion, onDecided],
  );

  return (
    <>
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
          disabled={busy !== 'idle' || qcRunId === null}
          onClick={() => {
            setSendBackOpen(true);
          }}
        >
          {t('review.action.send_back')}
        </button>
        <button
          type={'button'}
          className={'btn btn-primary'}
          disabled={busy !== 'idle' || qcRunId === null}
          onClick={approve}
        >
          {busy === 'approving' ? t('review.action.approving') : t('review.action.approve')}
        </button>
      </div>
      <SendBackDialog
        open={sendBackOpen}
        busy={busy === 'sending'}
        onClose={() => {
          setSendBackOpen(false);
        }}
        onSubmit={sendBack}
      />
    </>
  );
}
