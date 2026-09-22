// The case flow (W1-06, Lane B): overview, version navigation and the nine-slot pack editor or a frozen version,
// as one screen over the W0-02 section 7 contract behind W1-07's RequireSession. Loads the case and configuration
// (7.3), the open draft (7.5) when the case has one, the version list and the selected version (7.6), and the
// metadata of every attached artifact (7.4) through the typed client. Every answer is rendered as received: a
// 401 drops the session so the router sends the viewer to sign-in with `returnTo`; a 403 or 404 is shown as the
// envelope's message key. No client-side rule decides access (W0-05 "UI convenience"; W0-02 section 1.1).

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import type { SessionInfo } from '@rai/shared/schemas/auth';
import type { ArtifactRef } from '@rai/shared/schemas/artifacts';
import type { CaseView, ConfigurationView } from '@rai/shared/schemas/cases';
import type { PackDraft, PackDraftUpdateRequest, SlotNumber, SlotState } from '@rai/shared/schemas/pack';
import type { LaneDecisionResponse, DispositionResponse } from '@rai/shared/schemas/review';
import type { SubmittedVersion, VersionSummary } from '@rai/shared/schemas/versions';
import { ApiError, api } from '../../api/client.js';
import { ErrorNotice } from '../../components/error-notice.js';
import { useLocale } from '../../i18n/locale-provider.js';
import { ROUTES } from '../../routes.js';
import { useSession } from '../../session/session-provider.js';
import './case.css';
import { CaseOverview } from './case-overview.js';
import { PackEditor, type PendingSettings } from './pack-editor.js';
import { PackFrozen } from './pack-frozen.js';
import { ReviewerWorkspace } from './reviewer-workspace.js';
import type { ArtifactLookup } from './slot-rows.js';
import { VersionNav } from './version-nav.js';
import { SLOT_NUMBERS, applySlotChange, type PendingSlots } from './view-model.js';

interface Loaded {
  configuration: ConfigurationView;
  view: CaseView;
  draft: PackDraft | null;
  versions: VersionSummary[];
}

type LoadResult = { kind: 'error'; error: unknown } | ({ kind: 'ready' } & Loaded);
type LoadState = { kind: 'loading' } | LoadResult;

type VersionResult = { kind: 'error'; error: unknown } | { kind: 'ready'; version: SubmittedVersion };
type VersionState = { kind: 'idle' } | { kind: 'loading' } | VersionResult;

export type Notice =
  | { key: 'pack.saved' | 'pack.submitted'; params: Record<string, string | number> }
  | { key: 'review.decided.approve' | 'review.decided.send_back'; params: Record<string, string | number> }
  | { key: 'review.decided.ready'; params: Record<string, string | number> };

async function loadAll(caseId: string): Promise<Loaded> {
  const [configuration, view, versions] = await Promise.all([
    api.getConfiguration(),
    api.getCase(caseId),
    api.listVersions(caseId),
  ]);
  const draft = view.draft === null ? null : await api.getDraft(caseId);
  return { configuration, view, draft, versions: versions.items };
}

export function CaseScreen(): JSX.Element {
  const params = useParams<{ caseId: string; versionId?: string }>();
  const caseId = params.caseId ?? '';
  const versionId = params.versionId;
  const navigate = useNavigate();
  const { signedOut, state: sessionState } = useSession();

  // Loading is derived: a result is current only when it was produced for the key of the current request, so
  // no effect sets state synchronously (react-hooks/set-state-in-effect); the async callbacks set it.
  const [reloadToken, setReloadToken] = useState(0);
  const loadKey = `${caseId}#${reloadToken}`;
  const versionKey = versionId === undefined ? null : `${caseId}/${versionId}#${reloadToken}`;
  const [loadResult, setLoadResult] = useState<{ key: string; result: LoadResult } | null>(null);
  const [versionResult, setVersionResult] = useState<{ key: string; result: VersionResult } | null>(null);
  const [artifacts, setArtifacts] = useState<ReadonlyMap<string, ArtifactLookup>>(new Map());
  const artifactsInFlight = useRef(new Set<string>());
  const [pendingSlots, setPendingSlots] = useState<PendingSlots>({});
  const [pendingSettings, setPendingSettings] = useState<PendingSettings>({});
  const [busy, setBusy] = useState<'idle' | 'saving' | 'submitting'>('idle');
  const [editorError, setEditorError] = useState<unknown>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const state: LoadState =
    loadResult !== null && loadResult.key === loadKey ? loadResult.result : { kind: 'loading' };
  const versionState: VersionState =
    versionKey === null
      ? { kind: 'idle' }
      : versionResult !== null && versionResult.key === versionKey
        ? versionResult.result
        : { kind: 'loading' };

  /** A 401 during use: the session is gone; RequireSession then shows sign-in with `returnTo` (W0-02 7.2). */
  const unauthenticated = useCallback(
    (err: unknown): boolean => {
      if (err instanceof ApiError && err.status === 401) {
        signedOut('revoked');
        return true;
      }
      return false;
    },
    [signedOut],
  );

  // Load everything for the case; re-run on reload.
  useEffect(() => {
    let cancelled = false;
    void loadAll(caseId)
      .then((loaded) => {
        if (cancelled) return;
        setLoadResult({ key: loadKey, result: { kind: 'ready', ...loaded } });
        setPendingSlots({});
        setPendingSettings({});
      })
      .catch((err: unknown) => {
        if (cancelled || unauthenticated(err)) return;
        setLoadResult({ key: loadKey, result: { kind: 'error', error: err } });
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, loadKey, unauthenticated]);

  // The selected frozen version, when the route names one.
  useEffect(() => {
    if (versionKey === null || versionId === undefined) return;
    let cancelled = false;
    void api
      .getVersion(caseId, versionId)
      .then((version) => {
        if (!cancelled) setVersionResult({ key: versionKey, result: { kind: 'ready', version } });
      })
      .catch((err: unknown) => {
        if (cancelled || unauthenticated(err)) return;
        setVersionResult({ key: versionKey, result: { kind: 'error', error: err } });
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, versionId, versionKey, unauthenticated]);

  // Artifact metadata for every attached slot of the draft (frozen versions embed their references). An id
  // absent from the map renders as loading; the in-flight set keeps one request per id.
  const draft = state.kind === 'ready' ? state.draft : null;
  useEffect(() => {
    if (draft === null) return;
    for (const slot of SLOT_NUMBERS) {
      const saved = draft.slots[slot];
      if (saved.state !== 'attached') continue;
      const id = saved.artifactId;
      if (artifacts.has(id) || artifactsInFlight.current.has(id)) continue;
      artifactsInFlight.current.add(id);
      void api
        .getArtifactMeta(id)
        .then((ref) => {
          setArtifacts((prev) => new Map(prev).set(id, ref));
        })
        .catch(() => {
          setArtifacts((prev) => new Map(prev).set(id, 'unavailable'));
        })
        .finally(() => {
          artifactsInFlight.current.delete(id);
        });
    }
  }, [draft, artifacts]);

  const reload = (): void => {
    setEditorError(null);
    setNotice(null);
    setReloadToken((n) => n + 1);
  };

  const onSlotChange = (slot: SlotNumber, next: SlotState, artifact: ArtifactRef | undefined): void => {
    if (draft === null) return;
    if (artifact !== undefined) setArtifacts((prev) => new Map(prev).set(artifact.artifactId, artifact));
    setPendingSlots((prev) => applySlotChange(draft.slots, prev, slot, next));
    setNotice(null);
    setEditorError(null);
  };

  const onSave = (): void => {
    if (state.kind !== 'ready' || state.draft === null) return;
    const current = state.draft;
    const body: PackDraftUpdateRequest = {
      expectedVersion: { versionId: current.draftId, revision: current.draftRevision },
    };
    if (Object.keys(pendingSlots).length > 0) body.slots = pendingSlots;
    if (pendingSettings.checklistTemplateVersion !== undefined)
      body.checklistTemplateVersion = pendingSettings.checklistTemplateVersion;
    if (pendingSettings.stageContext !== undefined) body.stageContext = pendingSettings.stageContext;
    setBusy('saving');
    setEditorError(null);
    setNotice(null);
    const ready = state;
    void api
      .saveDraft(caseId, body)
      .then(async (saved) => {
        const view = await api.getCase(caseId);
        setLoadResult({ key: loadKey, result: { ...ready, view, draft: saved } });
        setPendingSlots({});
        setPendingSettings({});
        setNotice({ key: 'pack.saved', params: { revision: saved.draftRevision } });
      })
      .catch((err: unknown) => {
        if (!unauthenticated(err)) setEditorError(err);
      })
      .finally(() => {
        setBusy('idle');
      });
  };

  const onSubmit = (): void => {
    if (state.kind !== 'ready' || state.draft === null) return;
    const current = state.draft;
    setBusy('submitting');
    setEditorError(null);
    setNotice(null);
    void api
      .submitDraft(
        caseId,
        { expectedVersion: { versionId: current.draftId, revision: current.draftRevision } },
        crypto.randomUUID(), // W0-06 5.3: one key per user action
      )
      .then((version) => {
        setNotice({ key: 'pack.submitted', params: { number: version.versionNumber } });
        setReloadToken((n) => n + 1);
        void navigate(ROUTES.caseVersion(caseId, version.versionId));
      })
      .catch((err: unknown) => {
        if (!unauthenticated(err)) setEditorError(err);
      })
      .finally(() => {
        setBusy('idle');
      });
  };

  const onLaneDecided = (response: LaneDecisionResponse): void => {
    if (response.ready) {
      setNotice({ key: 'review.decided.ready', params: {} });
    } else if (response.decision === 'approve') {
      setNotice({ key: 'review.decided.approve', params: {} });
    } else {
      setNotice({ key: 'review.decided.send_back', params: {} });
    }
    setReloadToken((n) => n + 1);
  };

  const onDispositionRecorded = (response: DispositionResponse): void => {
    if (response.ready) {
      setNotice({ key: 'review.decided.ready', params: {} });
      setReloadToken((n) => n + 1);
    }
  };

  return (
    <CaseScreenBody
      caseId={caseId}
      versionId={versionId}
      state={state}
      versionState={versionState}
      artifacts={artifacts}
      pendingSlots={pendingSlots}
      pendingSettings={pendingSettings}
      busy={busy}
      editorError={editorError}
      notice={notice}
      session={sessionState.status === 'signed_in' ? sessionState.session : null}
      onSlotChange={onSlotChange}
      onSettingsChange={setPendingSettings}
      onSave={onSave}
      onDiscard={() => {
        setPendingSlots({});
        setPendingSettings({});
        setEditorError(null);
      }}
      onSubmit={onSubmit}
      onReload={reload}
      onDismissError={() => {
        setEditorError(null);
      }}
      onLaneDecided={onLaneDecided}
      onDispositionRecorded={onDispositionRecorded}
      onUnauthenticated={unauthenticated}
    />
  );
}

interface BodyProps {
  caseId: string;
  versionId: string | undefined;
  state: LoadState;
  versionState: VersionState;
  artifacts: ReadonlyMap<string, ArtifactLookup>;
  pendingSlots: PendingSlots;
  pendingSettings: PendingSettings;
  busy: 'idle' | 'saving' | 'submitting';
  editorError: unknown;
  notice: Notice | null;
  session: SessionInfo | null;
  onSlotChange: (slot: SlotNumber, next: SlotState, artifact: ArtifactRef | undefined) => void;
  onSettingsChange: (next: PendingSettings) => void;
  onSave: () => void;
  onDiscard: () => void;
  onSubmit: () => void;
  onReload: () => void;
  onDismissError: () => void;
  onLaneDecided: (response: LaneDecisionResponse) => void;
  onDispositionRecorded: (response: DispositionResponse) => void;
  onUnauthenticated: (err: unknown) => boolean;
}

function BackToList(): JSX.Element {
  const { t } = useLocale();
  return (
    <Link to={ROUTES.cases} className={'btn btn-ghost'}>
      {t('common.back_to_list')}
    </Link>
  );
}

function CaseScreenBody(props: BodyProps): JSX.Element {
  const { t } = useLocale();
  const { state, versionState, versionId, caseId } = props;

  if (state.kind === 'loading') {
    return (
      <div className={'case-screen'} aria-busy={true}>
        <BackToList />
        <p className={'muted'} role={'status'}>
          {t('common.loading')}
        </p>
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className={'case-screen'}>
        <BackToList />
        <h1>{t('common.error_title')}</h1>
        <ErrorNotice error={state.error}>
          <button type={'button'} className={'btn btn-secondary'} onClick={props.onReload}>
            {t('action.reload')}
          </button>
        </ErrorNotice>
      </div>
    );
  }

  // No route version, no open draft: the latest submitted version is the case's current content.
  if (versionId === undefined && state.draft === null && state.view.currentVersion !== null) {
    return <Navigate to={ROUTES.caseVersion(caseId, state.view.currentVersion.versionId)} replace={true} />;
  }

  return (
    <div className={'case-screen'}>
      <BackToList />
      <CaseOverview view={state.view} />
      <div className={'case-body'}>
        <VersionNav
          caseId={caseId}
          draft={state.draft === null ? null : state.view.draft}
          versions={state.versions}
        />
        <div className={'case-content'}>
          {versionId === undefined ? (
            state.draft !== null ? (
              <PackEditor
                caseId={caseId}
                draft={state.draft}
                configuration={state.configuration}
                artifacts={props.artifacts}
                pendingSlots={props.pendingSlots}
                pendingSettings={props.pendingSettings}
                busy={props.busy}
                error={props.editorError}
                notice={
                  props.notice !== null &&
                  (props.notice.key === 'pack.saved' || props.notice.key === 'pack.submitted')
                    ? props.notice
                    : null
                }
                onSlotChange={props.onSlotChange}
                onSettingsChange={props.onSettingsChange}
                onSave={props.onSave}
                onDiscard={props.onDiscard}
                onSubmit={props.onSubmit}
                onReload={props.onReload}
                onDismissError={props.onDismissError}
              />
            ) : (
              <p className={'muted'} role={'status'}>
                {t('pack.no_draft')}
              </p>
            )
          ) : versionState.kind === 'ready' ? (
            <>
              {props.notice !== null ? (
                <p className={'notice notice-success'} role={'status'}>
                  {t(props.notice.key, props.notice.params)}
                </p>
              ) : null}
              {props.session !== null ? (
                <ReviewerWorkspace
                  caseId={caseId}
                  version={versionState.version}
                  view={state.view}
                  hasOpenDraft={state.draft !== null}
                  session={props.session}
                  onDecided={props.onLaneDecided}
                  onDispositionRecorded={props.onDispositionRecorded}
                  onUnauthenticated={props.onUnauthenticated}
                />
              ) : null}
              <PackFrozen version={versionState.version} versions={state.versions} />
            </>
          ) : versionState.kind === 'error' ? (
            <ErrorNotice error={versionState.error}>
              <button type={'button'} className={'btn btn-secondary'} onClick={props.onReload}>
                {t('action.reload')}
              </button>
            </ErrorNotice>
          ) : (
            <p className={'muted'} role={'status'}>
              {t('common.loading')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
