// One lane's review of the latest version, or the owner/BU-SPOC panel that proposes fixes. A lane shows every
// stored finding the server assigned to it, whichever run produced it; the lane-QC run comes first because approve
// must name the run the reviewer saw. The API decides every action; this only draws the controls.

import { useCallback, useEffect, useState, type JSX } from 'react';
import type { CaseView } from '@rai/shared/schemas/cases';
import type { Lane } from '@rai/shared/constants';
import type {
  DispositionKind,
  DispositionResponse,
  LaneDecisionResponse,
  LaneQcRunResponse,
  StoredFindingSummary,
  VersionFindingsResponse,
} from '@rai/shared/schemas/review';
import type { SubmittedVersion } from '@rai/shared/schemas/versions';
import type { SessionInfo } from '@rai/shared/schemas/auth';
import { api } from '../../api/client.js';
import { ErrorNotice } from '../../components/error-notice.js';
import { useLocale } from '../../i18n/locale-provider.js';
import { FindingsList, QcUnavailableBlock } from './finding-list.js';
import { LaneDecisionActions } from './lane-decision-actions.js';
import { expectedVersionOf, laneIsDecidable, laneKey, reviewerFindingsLoadMode } from './view-model.js';

interface LaneFindings {
  findings: StoredFindingSummary[];
  latestKinds: ReadonlyMap<string, DispositionKind | null>;
}
type Loaded = { kind: 'ready'; run: LaneQcRunResponse | null } & LaneFindings;
type LoadResult = { kind: 'error'; error: unknown } | Loaded;
type LoadState = { kind: 'loading' } | LoadResult;

/** The lane's share of the version's stored findings; the proposal panel (null) takes all of them. */
function laneFindings(listed: VersionFindingsResponse, lane: Lane | null): LaneFindings {
  const latestKinds = new Map<string, DispositionKind | null>();
  const findings: StoredFindingSummary[] = [];
  for (const { latestDisposition, ...summary } of listed.findings) {
    latestKinds.set(summary.findingId, latestDisposition);
    if (lane === null || summary.owningLane === lane) findings.push(summary);
  }
  return { findings, latestKinds };
}

export interface ReviewerWorkspaceProps {
  caseId: string;
  version: SubmittedVersion;
  view: CaseView;
  hasOpenDraft: boolean;
  session: SessionInfo;
  /** The reviewed lane; null for the owner/BU-SPOC proposal panel. */
  lane: Lane | null;
  onDecided: (response: LaneDecisionResponse) => void;
  onDispositionRecorded: (response: DispositionResponse) => void;
}

export function ReviewerWorkspace({
  caseId,
  version,
  view,
  hasOpenDraft,
  session,
  lane,
  onDecided,
  onDispositionRecorded,
}: ReviewerWorkspaceProps): JSX.Element | null {
  const { t } = useLocale();
  const loadMode = reviewerFindingsLoadMode(view, lane);
  const loadKey = `${caseId}/${version.versionId}/${lane ?? 'propose'}/${loadMode}`;
  const [stored, setStored] = useState<{ key: string; result: LoadResult } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const expectedVersion = expectedVersionOf(version);
  const state: LoadState =
    stored !== null && stored.key === `${loadKey}#${reloadToken}` ? stored.result : { kind: 'loading' };

  useEffect(() => {
    let cancelled = false;
    const key = `${loadKey}#${reloadToken}`;
    const load = async (): Promise<LoadResult> => {
      const run =
        loadMode === 'lane_qc' && lane !== null
          ? await api.runLaneQc(caseId, version.versionId, lane, {
              expectedVersion: expectedVersionOf(version),
            })
          : null;
      const listed = await api.listVersionFindings(caseId, version.versionId);
      return { kind: 'ready', run, ...laneFindings(listed, lane) };
    };
    void load()
      .then((result) => {
        if (!cancelled) setStored({ key, result });
      })
      .catch((err: unknown) => {
        if (!cancelled) setStored({ key, result: { kind: 'error', error: err } });
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, version, lane, loadMode, loadKey, reloadToken]);

  const onDisposition = useCallback(
    (response: DispositionResponse): void => {
      const update = (next: (loaded: Loaded) => Partial<LaneFindings>): void => {
        setStored((prev) =>
          prev?.result.kind === 'ready'
            ? { key: prev.key, result: { ...prev.result, ...next(prev.result) } }
            : prev,
        );
      };
      // The recorded kind shows at once; the refetch then brings the server's view of every finding.
      update((loaded) => ({
        latestKinds: new Map(loaded.latestKinds).set(response.findingId, response.kind),
      }));
      onDispositionRecorded(response);
      void api
        .listVersionFindings(caseId, version.versionId)
        .then((listed) => {
          update(() => laneFindings(listed, lane));
        })
        .catch(() => undefined); // the recorded kind stays; the next load brings the server's view
    },
    [onDispositionRecorded, caseId, version.versionId, lane],
  );

  const errorNotice = (error: unknown): JSX.Element => (
    <ErrorNotice error={error}>
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
  );

  // The proposal panel appears only once it has findings: no loading or empty status of its own.
  if (lane === null && state.kind === 'loading') return null;
  if (lane === null && state.kind === 'ready' && state.findings.length === 0) return null;
  if (lane === null && state.kind === 'error') return errorNotice(state.error);

  const isReady = view.aiReadinessStatus === 'ready';
  const headingId = `reviewer-findings-heading-${lane ?? 'owner'}`;
  const unavailableRun = state.kind === 'ready' && state.run?.status === 'unavailable' ? state.run : null;
  return (
    <section className={'card reviewer-workspace'} aria-labelledby={headingId}>
      <div className={'panel-head'}>
        <div>
          <h2 id={headingId}>
            {lane === null
              ? t('review.disposition.owner_heading')
              : t('review.findings.heading', { lane: t(laneKey(lane)) })}
          </h2>
          {isReady ? null : (
            <p className={'muted'}>
              {t(lane === null ? 'review.disposition.owner_intro' : 'review.findings.intro')}
            </p>
          )}
        </div>
      </div>

      {state.kind === 'loading' ? (
        <p className={'muted'} role={'status'} data-review-qc={'loading'}>
          {t('review.findings.loading')}
        </p>
      ) : null}

      {state.kind === 'error' ? errorNotice(state.error) : null}

      {state.kind === 'ready' ? (
        <>
          {unavailableRun !== null ? <QcUnavailableBlock run={unavailableRun} /> : null}
          {/* An unavailable run with nothing stored must not also read "no defects". */}
          {unavailableRun !== null && state.findings.length === 0 ? null : (
            <FindingsList
              findings={state.findings}
              latestKinds={state.latestKinds}
              caseId={caseId}
              expectedVersion={expectedVersion}
              session={session}
              view={view}
              onDisposition={onDisposition}
            />
          )}
          {lane !== null && state.run !== null && laneIsDecidable({ lane, view, hasOpenDraft }) ? (
            <LaneDecisionActions
              caseId={caseId}
              versionId={version.versionId}
              lane={lane}
              expectedVersion={expectedVersion}
              qcRunId={state.run.runId}
              onDecided={onDecided}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}
