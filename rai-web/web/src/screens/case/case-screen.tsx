// The case flow (W1-06): overview, version navigation and the nine-slot pack editor or a frozen version, as one
// screen over the W0-02 section 7 contract. Loads the session (7.2), the case and configuration (7.3), the open
// draft (7.5) when the case has one, the version list and the selected version (7.6), and the metadata of
// every attached artifact (7.4). Every answer is rendered as received: a 401 sends the viewer to the sign-in
// route with `returnTo`; a 403 or 404 is shown as the envelope's message key. No client-side rule decides
// access (W0-05 "UI convenience"; W0-02 section 1.1).

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { Locale } from '@rai/shared/locales/keys';
import { DEFAULT_LOCALE, t as render } from '@rai/shared/locales/keys';
import type { ArtifactRef } from '@rai/shared/schemas/artifacts';
import type { CaseView, ConfigurationView } from '@rai/shared/schemas/cases';
import type { PackDraft, PackDraftUpdateRequest, SlotNumber, SlotState } from '@rai/shared/schemas/pack';
import type { SubmittedVersion, VersionSummary } from '@rai/shared/schemas/versions';
import { ApiError, isApiError } from '../../api/client.js';
import {
  getArtifactMeta,
  getCase,
  getConfiguration,
  getDraft,
  getSession,
  getVersion,
  listVersions,
  saveDraft,
  submitDraft,
} from '../../api/case.js';
import './case.css';
import { CaseOverview } from './case-overview.js';
import { ErrorNotice } from './error-notice.js';
import { LocaleProvider, useT } from './locale.js';
import { PackEditor, type PendingSettings } from './pack-editor.js';
import { PackFrozen } from './pack-frozen.js';
import type { ArtifactLookup } from './slot-rows.js';
import { VersionNav } from './version-nav.js';
import {
  SLOT_NUMBERS,
  applySlotChange,
  presentError,
  signInPath,
  versionPath,
  type ErrorPresentation,
  type PendingSlots,
} from './view-model.js';

interface Loaded {
  locale: Locale;
  configuration: ConfigurationView;
  view: CaseView;
  draft: PackDraft | null;
  versions: VersionSummary[];
}

type LoadResult = { kind: 'error'; error: ErrorPresentation; status: number } | ({ kind: 'ready' } & Loaded);
type LoadState = { kind: 'loading' } | LoadResult;

type VersionResult =
  { kind: 'error'; error: ErrorPresentation } | { kind: 'ready'; version: SubmittedVersion };
type VersionState = { kind: 'idle' } | { kind: 'loading' } | VersionResult;

type Notice = { key: 'pack.saved' | 'pack.submitted'; params: Record<string, string | number> };

function toApiError(err: unknown): ApiError {
  return isApiError(err)
    ? err
    : new ApiError({
        status: 0,
        code: 'network',
        messageKey: 'error.internal_error',
        correlationId: null,
        details: undefined,
      });
}

async function loadAll(caseId: string): Promise<Loaded> {
  const session = await getSession(); // 401 first: nothing else is asked without a session
  const [configuration, view, versions] = await Promise.all([
    getConfiguration(),
    getCase(caseId),
    listVersions(caseId),
  ]);
  const draft = view.draft === null ? null : await getDraft(caseId);
  return { locale: session.locale, configuration, view, draft, versions: versions.items };
}

export function CaseScreen(): JSX.Element {
  const params = useParams<{ caseId: string; versionId?: string }>();
  const caseId = params.caseId ?? '';
  const versionId = params.versionId;
  const navigate = useNavigate();
  const location = useLocation();

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
  const [editorError, setEditorError] = useState<ErrorPresentation | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const state: LoadState =
    loadResult !== null && loadResult.key === loadKey ? loadResult.result : { kind: 'loading' };
  const versionState: VersionState =
    versionKey === null
      ? { kind: 'idle' }
      : versionResult !== null && versionResult.key === versionKey
        ? versionResult.result
        : { kind: 'loading' };

  const currentPath = `${location.pathname}${location.search}`;

  const toSignIn = useCallback((): void => {
    void navigate(signInPath(currentPath), { replace: true });
  }, [navigate, currentPath]);

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
        if (cancelled) return;
        const error = toApiError(err);
        if (error.status === 401) {
          toSignIn();
          return;
        }
        setLoadResult({
          key: loadKey,
          result: { kind: 'error', error: presentError(error), status: error.status },
        });
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, loadKey, toSignIn]);

  // The selected frozen version, when the route names one.
  useEffect(() => {
    if (versionKey === null || versionId === undefined) return;
    let cancelled = false;
    void getVersion(caseId, versionId)
      .then((version) => {
        if (!cancelled) setVersionResult({ key: versionKey, result: { kind: 'ready', version } });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const error = toApiError(err);
        if (error.status === 401) {
          toSignIn();
          return;
        }
        setVersionResult({ key: versionKey, result: { kind: 'error', error: presentError(error) } });
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, versionId, versionKey, toSignIn]);

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
      void getArtifactMeta(id)
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

  // <html lang> and the document title follow the session locale (section 10.4) and the case identity.
  const locale = state.kind === 'ready' ? state.locale : DEFAULT_LOCALE;
  const registryId = state.kind === 'ready' ? state.view.registryId : null;
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title =
      registryId === null ? render(locale, 'app.title') : `${registryId} · ${render(locale, 'app.title')}`;
  }, [locale, registryId]);

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
    void saveDraft(caseId, body)
      .then(async (saved) => {
        const view = await getCase(caseId);
        setLoadResult({ key: loadKey, result: { ...ready, view, draft: saved } });
        setPendingSlots({});
        setPendingSettings({});
        setNotice({ key: 'pack.saved', params: { revision: saved.draftRevision } });
      })
      .catch((err: unknown) => {
        const error = toApiError(err);
        if (error.status === 401) {
          toSignIn();
          return;
        }
        setEditorError(presentError(error));
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
    void submitDraft(
      caseId,
      { expectedVersion: { versionId: current.draftId, revision: current.draftRevision } },
      crypto.randomUUID(), // W0-06 5.3: one key per user action
    )
      .then((version) => {
        setNotice({ key: 'pack.submitted', params: { number: version.versionNumber } });
        setReloadToken((n) => n + 1);
        void navigate(versionPath(caseId, version.versionId));
      })
      .catch((err: unknown) => {
        const error = toApiError(err);
        if (error.status === 401) {
          toSignIn();
          return;
        }
        setEditorError(presentError(error));
      })
      .finally(() => {
        setBusy('idle');
      });
  };

  return (
    <LocaleProvider locale={locale}>
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
      />
    </LocaleProvider>
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
  editorError: ErrorPresentation | null;
  notice: Notice | null;
  onSlotChange: (slot: SlotNumber, next: SlotState, artifact: ArtifactRef | undefined) => void;
  onSettingsChange: (next: PendingSettings) => void;
  onSave: () => void;
  onDiscard: () => void;
  onSubmit: () => void;
  onReload: () => void;
  onDismissError: () => void;
}

function CaseScreenBody(props: BodyProps): JSX.Element {
  const t = useT();
  const { state, versionState, versionId, caseId } = props;

  if (state.kind === 'loading') {
    return (
      <main className="rai-case" aria-busy="true">
        <p className="rai-muted" role="status">
          {t('case.loading')}
        </p>
      </main>
    );
  }
  if (state.kind === 'error') {
    return (
      <main className="rai-case">
        <Link to="/" className="rai-link rai-back">
          {t('case.back_to_list')}
        </Link>
        <h1 className="rai-case-head__title">{t('error.heading')}</h1>
        <ErrorNotice error={state.error} onReload={props.onReload} />
      </main>
    );
  }

  // No route version, no open draft: the latest submitted version is the case's current content.
  if (versionId === undefined && state.draft === null && state.view.currentVersion !== null) {
    return <Navigate to={versionPath(caseId, state.view.currentVersion.versionId)} replace />;
  }

  return (
    <main className="rai-case">
      <Link to="/" className="rai-link rai-back">
        {t('case.back_to_list')}
      </Link>
      <CaseOverview view={state.view} />
      <div className="rai-case__body">
        <VersionNav
          caseId={caseId}
          draft={state.draft === null ? null : state.view.draft}
          versions={state.versions}
        />
        <div className="rai-case__content">
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
                notice={props.notice}
                onSlotChange={props.onSlotChange}
                onSettingsChange={props.onSettingsChange}
                onSave={props.onSave}
                onDiscard={props.onDiscard}
                onSubmit={props.onSubmit}
                onReload={props.onReload}
                onDismissError={props.onDismissError}
              />
            ) : (
              <p className="rai-muted" role="status">
                {t('pack.no_draft')}
              </p>
            )
          ) : versionState.kind === 'ready' ? (
            <>
              {props.notice !== null && (
                <p className="rai-notice rai-notice--ok" role="status">
                  {t(props.notice.key, props.notice.params)}
                </p>
              )}
              <PackFrozen version={versionState.version} versions={state.versions} />
            </>
          ) : versionState.kind === 'error' ? (
            <ErrorNotice error={versionState.error} onReload={props.onReload} />
          ) : (
            <p className="rai-muted" role="status">
              {t('version.loading')}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
