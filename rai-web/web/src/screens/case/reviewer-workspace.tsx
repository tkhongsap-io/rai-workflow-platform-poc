// Reviewer workspace (W2-07 / W2-09): owning-lane reviewer runs qc-run then enriches latestDisposition via
// GET …/findings; owner/BU SPOC loads that GET only and may propose fixed. After every disposition POST the
// GET is refetched so reload shows the kind. qc-run auth is unchanged. Issue #35 stays open.

import { useCallback, useEffect, useState, type JSX } from 'react';
import type { CaseView } from '@rai/shared/schemas/cases';
import type { Lane } from '@rai/shared/constants';
import type {
  DispositionKind,
  DispositionResponse,
  LaneDecisionResponse,
  LaneQcRunResponse,
  StoredFindingSummary,
} from '@rai/shared/schemas/review';
import type { SubmittedVersion } from '@rai/shared/schemas/versions';
import type { SessionInfo } from '@rai/shared/schemas/auth';
import { api } from '../../api/client.js';
import { ErrorNotice } from '../../components/error-notice.js';
import { useLocale } from '../../i18n/locale-provider.js';
import { FindingsList, QcUnavailableBlock } from './finding-list.js';
import { LaneDecisionActions } from './lane-decision-actions.js';
import {
  canProposeFixedOnCase,
  decidableLane,
  expectedVersionOf,
  findingsLane,
  laneKey,
} from './view-model.js';

type LoadResult =
  | { kind: 'error'; error: unknown }
  | {
      kind: 'ready';
      run: LaneQcRunResponse | null;
      findings: StoredFindingSummary[];
      latestKinds: ReadonlyMap<string, DispositionKind | null>;
    };
type LoadState = { kind: 'loading' } | LoadResult;

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
  const roles = props.session.principal.roles;
  const subjectId = props.session.principal.subjectId;
  const lane = findingsLane({
    roles,
    subjectId,
    view: props.view,
    version: props.version,
  });
  const propose =
    lane === null && props.version.isLatest && canProposeFixedOnCase(roles, subjectId, props.view);
  if (lane === null && !propose) return null;
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
}: ReviewerWorkspaceProps & { lane: Lane | null }): JSX.Element {
  const { t } = useLocale();
  const loadKey = `${caseId}/${version.versionId}/${lane ?? 'propose'}`;
  const [stored, setStored] = useState<{ key: string; result: LoadResult } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [overlay, setOverlay] = useState<ReadonlyMap<string, DispositionKind>>(new Map());
  const expectedVersion = expectedVersionOf(version);
  const decideLane =
    lane === null
      ? null
      : decidableLane({
          roles: session.principal.roles,
          subjectId: session.principal.subjectId,
          view,
          version,
          hasOpenDraft,
        });
  const state: LoadState =
    stored !== null && stored.key === `${loadKey}#${reloadToken}` ? stored.result : { kind: 'loading' };

  useEffect(() => {
    let cancelled = false;
    const key = `${loadKey}#${reloadToken}`;
    const load = async (): Promise<LoadResult> => {
      if (lane !== null) {
        const run = await api.runLaneQc(caseId, version.versionId, lane, {
          expectedVersion: { versionId: version.versionId, revision: 1 },
        });
        const listed = await api.listVersionFindings(caseId, version.versionId);
        const latestKinds = new Map<string, DispositionKind | null>();
        for (const f of listed.findings) latestKinds.set(f.findingId, f.latestDisposition);
        return {
          kind: 'ready',
          run,
          findings: run.status === 'completed' ? run.findings : [],
          latestKinds,
        };
      }
      const listed = await api.listVersionFindings(caseId, version.versionId);
      const latestKinds = new Map<string, DispositionKind | null>();
      for (const f of listed.findings) latestKinds.set(f.findingId, f.latestDisposition);
      return {
        kind: 'ready',
        run: null,
        findings: listed.findings.map(({ latestDisposition: _ld, ...summary }) => summary),
        latestKinds,
      };
    };
    void load()
      .then((result) => {
        if (!cancelled) setStored({ key, result });
      })
      .catch((err: unknown) => {
        if (cancelled || onUnauthenticated(err)) return;
        setStored({ key, result: { kind: 'error', error: err } });
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, version.versionId, lane, loadKey, reloadToken, onUnauthenticated]);

  const onDisposition = useCallback(
    (response: DispositionResponse): void => {
      setOverlay((prev) => {
        const next = new Map(prev);
        next.set(response.findingId, response.kind);
        return next;
      });
      onDispositionRecorded(response);
      void api
        .listVersionFindings(caseId, version.versionId)
        .then((listed) => {
          const latestKinds = new Map<string, DispositionKind | null>();
          for (const f of listed.findings) latestKinds.set(f.findingId, f.latestDisposition);
          setStored((prev) => {
            if (prev === null || prev.result.kind !== 'ready') return prev;
            return {
              key: prev.key,
              result: {
                ...prev.result,
                latestKinds,
                ...(lane === null
                  ? {
                      findings: listed.findings.map(({ latestDisposition: _ld, ...summary }) => summary),
                    }
                  : {}),
              },
            };
          });
        })
        .catch((err: unknown) => {
          void onUnauthenticated(err);
        });
    },
    [onDispositionRecorded, caseId, version.versionId, lane, onUnauthenticated],
  );

  const headingLane = lane !== null ? t(laneKey(lane)) : t('role.owner');
  const mergedKinds = (
    base: ReadonlyMap<string, DispositionKind | null>,
  ): Map<string, DispositionKind | null> => {
    const out = new Map(base);
    for (const [id, kind] of overlay) out.set(id, kind);
    return out;
  };

  return (
    <section className={'card reviewer-workspace'} aria-labelledby={'reviewer-findings-heading'}>
      <div className={'panel-head'}>
        <div>
          <h2 id={'reviewer-findings-heading'}>{t('review.findings.heading', { lane: headingLane })}</h2>
          <p className={'muted'}>{t('review.findings.intro')}</p>
        </div>
      </div>

      {state.kind === 'loading' ? (
        <p className={'muted'} role={'status'} data-review-qc={'loading'}>
          {t('review.findings.loading')}
        </p>
      ) : null}

      {state.kind === 'error' ? (
        <ErrorNotice error={state.error}>
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

      {state.kind === 'ready' ? (
        <>
          {state.run !== null && state.run.status === 'unavailable' ? (
            <QcUnavailableBlock run={state.run} />
          ) : (
            <FindingsList
              findings={state.findings}
              latestKinds={mergedKinds(state.latestKinds)}
              caseId={caseId}
              expectedVersion={expectedVersion}
              session={session}
              view={view}
              onDisposition={onDisposition}
              onUnauthenticated={onUnauthenticated}
            />
          )}
          {decideLane !== null && state.run !== null ? (
            <LaneDecisionActions
              caseId={caseId}
              versionId={version.versionId}
              lane={decideLane}
              expectedVersion={expectedVersion}
              qcRunId={state.run.runId}
              onDecided={onDecided}
              onUnauthenticated={onUnauthenticated}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}
