// One button per disposition kind the actor may record on a finding; waived and N/A ask for a reason first. The
// finding's owning lane is the one the server stored; nothing here assigns one.

import { useState, type JSX } from 'react';
import type { CaseView } from '@rai/shared/schemas/cases';
import type { DispositionKind, DispositionResponse, StoredFindingSummary } from '@rai/shared/schemas/review';
import type { ExpectedVersion } from '@rai/shared/schemas/versions';
import type { SessionInfo } from '@rai/shared/schemas/auth';
import { api } from '../../api/client.js';
import { ErrorNotice } from '../../components/error-notice.js';
import { useLocale } from '../../i18n/locale-provider.js';
import { DispositionDialog } from './disposition-dialog.js';
import { dispositionKindKey, dispositionKindNeedsReason, dispositionKindsForActor } from './view-model.js';

export interface DispositionControlsProps {
  caseId: string;
  finding: StoredFindingSummary;
  expectedVersion: ExpectedVersion;
  session: SessionInfo;
  view: CaseView;
  latestKind: DispositionKind | null;
  onRecorded: (response: DispositionResponse) => void;
}

export function DispositionControls({
  caseId,
  finding,
  expectedVersion,
  session,
  view,
  latestKind,
  onRecorded,
}: DispositionControlsProps): JSX.Element | null {
  const { t } = useLocale();
  const kinds = dispositionKindsForActor({
    roles: session.principal.roles,
    subjectId: session.principal.subjectId,
    view,
    findingOwningLane: finding.owningLane,
    latestKind,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [pendingKind, setPendingKind] = useState<DispositionKind | null>(null);

  const post = (kind: DispositionKind, reason: string | undefined): void => {
    setBusy(true);
    setError(null);
    void api
      .recordDisposition(
        caseId,
        finding.findingId,
        {
          expectedVersion,
          kind,
          ...(reason === undefined ? {} : { reason }),
        },
        crypto.randomUUID(),
      )
      .then((response) => {
        setPendingKind(null);
        onRecorded(response);
      })
      .catch((err: unknown) => {
        setError(err);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const activate = (kind: DispositionKind): void => {
    if (dispositionKindNeedsReason(kind)) {
      setPendingKind(kind);
      return;
    }
    post(kind, undefined);
  };

  if (kinds.length === 0 && latestKind === null) return null;

  return (
    <div className={'disposition-controls'} data-disposition-controls={finding.findingId}>
      {latestKind !== null ? (
        <p className={'muted small disposition-status'} data-disposition-kind={latestKind} role={'status'}>
          {t('review.disposition.status_label', { kind: t(dispositionKindKey(latestKind)) })}
        </p>
      ) : null}
      {kinds.length > 0 ? (
        <div
          className={'disposition-actions'}
          role={'group'}
          aria-label={t('review.disposition.actions_label')}
        >
          {kinds.map((kind) => (
            <button
              key={kind}
              type={'button'}
              className={'btn btn-secondary'}
              data-disposition-kind-action={kind}
              disabled={busy}
              onClick={() => {
                activate(kind);
              }}
            >
              {t(dispositionKindKey(kind))}
            </button>
          ))}
        </div>
      ) : null}
      {error !== null ? (
        <ErrorNotice error={error}>
          <button
            type={'button'}
            className={'btn btn-ghost'}
            onClick={() => {
              setError(null);
            }}
          >
            {t('action.dismiss')}
          </button>
        </ErrorNotice>
      ) : null}
      <DispositionDialog
        open={pendingKind !== null}
        kind={pendingKind}
        busy={busy}
        onClose={() => {
          setPendingKind(null);
        }}
        onSubmit={(reason) => {
          if (pendingKind === null) return;
          post(pendingKind, reason);
        }}
      />
    </div>
  );
}
