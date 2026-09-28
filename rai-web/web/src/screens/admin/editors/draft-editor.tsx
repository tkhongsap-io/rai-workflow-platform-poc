// W6-06 (W6 plan sections 1.2 Q1/Q5/Q16/Q18, 2.3 and 9): the draft of a simple kind, edited in its form. The form
// starts from the draft when there is one, else from the revision in force, and restarts whenever the page's data
// changes (after a save, a publish, a discard or a reload). "Save draft" keeps half-finished work on the server and
// the page lists what publishing would refuse; "Publish" opens the dialog that asks for the change note. A draft
// started from an earlier revision is read-only until it is started again from the revision in force or discarded.
// Every write names the draft version and revision the page showed, so an out-of-date page gets the 409 guidance
// and a Reload, never an overwrite. Access is the server's (`config.publish`).
//
// W6-11: the same flow edits the JSON kinds (`JSON_KINDS`, the identity mapping) in `JsonEditor`. Text that is not a
// JSON object is refused in the page and never sent; a served problem is labelled by its pointer.

import { useCallback, useEffect, useId, useRef, useState, type JSX } from 'react';
import type { LocaleKey } from '@rai/shared/locales/keys';
import type {
  ConfigurationDraftDetail,
  ConfigurationRevisionDetail,
  ConfigurationRevisionSummary,
} from '@rai/shared/schemas/configuration-admin';
import { api, ApiError } from '../../../api/client.js';
import { Dialog } from '../../../components/dialog.js';
import { ErrorNotice } from '../../../components/error-notice.js';
import { translateApiKey, useLocale } from '../../../i18n/locale-provider.js';
import { diffBodies } from '../diff.js';
import { PublishDialog, type PublishTarget } from '../publish-dialog.js';
import { CalendarEditor } from './calendar-editor.js';
import { JsonEditor } from './json-editor.js';
import { isJsonKind, jsonTextOf, parseJsonBody, type JsonKind } from './json-kinds.js';
import { ListEditor } from './list-editor.js';
import { RecipientsEditor } from './recipients-editor.js';
import {
  bodyOf,
  formOf,
  problemTarget,
  type ListKind,
  type SimpleForm,
  type SimpleKind,
  type SlaLane,
} from './simple-kinds.js';
import { SlaEditor } from './sla-editor.js';

const ITEM_LABEL: Readonly<Record<ListKind, LocaleKey>> = Object.freeze({
  calendar: 'admin.config.editor.item.calendar',
  use_case_groups: 'admin.config.editor.item.use_case_groups',
  operator_recipients: 'admin.config.editor.item.operator_recipients',
  checklist_templates: 'admin.config.editor.item.checklist_templates',
});

/** A simple kind's form, or a JSON kind's text (W6-11). */
type EditorForm = SimpleForm | { kind: 'json'; text: string };

function editorFormOf(
  kind: SimpleKind | JsonKind,
  body: Readonly<Record<string, unknown>> | undefined,
): EditorForm {
  return isJsonKind(kind) ? { kind: 'json', text: jsonTextOf(body) } : formOf(kind, body);
}

/** The body a save sends, or `undefined` when a JSON kind's text is not a JSON object (nothing is sent). */
function editorBodyOf(
  form: EditorForm,
  base: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> | undefined {
  if (form.kind !== 'json') return bodyOf(form, base);
  const parsed = parseJsonBody(form.text);
  return parsed.ok ? parsed.body : undefined;
}

export interface DraftEditorProps {
  kind: SimpleKind | JsonKind;
  kindLabelKey: LocaleKey;
  current: ConfigurationRevisionDetail | null;
  draft: ConfigurationDraftDetail | null;
  /** A save or a restart answered 200: the page shows the new draft. */
  onDraftSaved: (draft: ConfigurationDraftDetail) => void;
  onPublished: (published: ConfigurationRevisionSummary) => void;
  onDiscarded: () => void;
  /** Reloads the page's data (after a 409). */
  onReload: () => void;
}

type Status = { key: LocaleKey; params?: Record<string, number> };

export function DraftEditor({
  kind,
  kindLabelKey,
  current,
  draft,
  onDraftSaved,
  onPublished,
  onDiscarded,
  onReload,
}: DraftEditorProps): JSX.Element {
  const { t } = useLocale();
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const problemsId = `${baseId}-problems`;
  const discardTitleId = `${baseId}-discard-title`;
  const heading = useRef<HTMLHeadingElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);

  const savedBody = draft?.body ?? current?.body;
  const sourceKey = `${current?.revisionId ?? ''}|${draft?.draftVersion.toString() ?? ''}|${draft?.baseRevisionId ?? ''}`;
  const [form, setForm] = useState<EditorForm>(() => editorFormOf(kind, savedBody));
  // W6-11: the last save of a JSON kind was refused here (the text is not a JSON object).
  const [refused, setRefused] = useState(false);
  const [error, setError] = useState<unknown>();
  const [status, setStatus] = useState<Status>();
  const [busy, setBusy] = useState(false);
  const [publishTarget, setPublishTarget] = useState<PublishTarget>();
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardError, setDiscardError] = useState<unknown>();
  // Where focus goes after the render a restart or a reload causes (a ref: focus is not rendered state).
  const focusNext = useRef<'heading' | 'status'>(undefined);

  // The form restarts from the page's data whenever that data changes (React's "adjust state on a prop change").
  const [source, setSource] = useState(sourceKey);
  if (source !== sourceKey) {
    setSource(sourceKey);
    setForm(editorFormOf(kind, savedBody));
    setRefused(false);
    setError(undefined);
  }

  useEffect(() => {
    const target = focusNext.current;
    if (target === undefined) return;
    const element = target === 'heading' ? heading.current : statusRef.current;
    if (element === null) return;
    focusNext.current = undefined;
    element.focus();
  });

  const currentId = current?.revisionId ?? null;
  const stale = draft !== null && draft.baseRevisionId !== currentId;
  const body = editorBodyOf(form, savedBody);
  const dirty = savedBody === undefined || body === undefined || diffBodies(savedBody, body).length > 0;
  const publishable = draft !== null && !stale && !dirty && draft.problemCount === 0;
  const hintKey: LocaleKey | undefined = stale
    ? undefined
    : draft === null || dirty
      ? 'admin.config.editor.publish_needs_save'
      : draft.problemCount > 0
        ? 'admin.config.editor.publish_has_problems'
        : undefined;

  const save = async (next: Record<string, unknown>, baseRevisionId: string | null, restarted: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    try {
      const saved = await api.saveConfigurationDraft(kind, {
        baseRevisionId,
        expectedDraftVersion: draft?.draftVersion ?? null,
        body: next,
        ...(draft?.changeNote == null ? {} : { changeNote: draft.changeNote }),
      });
      setBusy(false);
      onDraftSaved(saved);
      setStatus(
        restarted && current !== null
          ? { key: 'admin.config.editor.started_again', params: { number: current.revisionNumber } }
          : { key: 'admin.config.editor.saved' },
      );
      if (restarted) focusNext.current = 'status';
    } catch (err) {
      setBusy(false);
      setError(err);
    }
  };

  const reloadFromEditor = useCallback(() => {
    focusNext.current = 'heading';
    onReload();
  }, [onReload]);

  const discard = async (): Promise<void> => {
    if (draft === null || busy) return;
    setBusy(true);
    setDiscardError(undefined);
    try {
      await api.discardConfigurationDraft(kind, { expectedDraftVersion: draft.draftVersion });
      setBusy(false);
      setDiscardOpen(false);
      onDiscarded();
    } catch (err) {
      setBusy(false);
      setDiscardError(err);
    }
  };

  const targets = (draft?.problems ?? []).map((problem) => ({
    problem,
    target: isJsonKind(kind) ? ({ whole: true } as const) : problemTarget(kind, problem.path),
  }));
  const invalidLanes = new Set<SlaLane>(
    targets.flatMap(({ target }) => ('lane' in target ? [target.lane] : [])),
  );
  const invalidIndexes = new Set<number>(
    targets.flatMap(({ target }) => ('index' in target ? [target.index] : [])),
  );
  const describedBy = targets.length > 0 ? problemsId : undefined;
  const fieldLabel = (target: ReturnType<typeof problemTarget>, path: string): string => {
    // A JSON kind's problem is named by its served pointer (the first segment of a schema problem).
    if (isJsonKind(kind)) return path === '/' ? t('admin.config.editor.problem_whole') : path;
    if ('lane' in target) return t(`lane.${target.lane}`);
    if ('index' in target && kind !== 'sla') return t(ITEM_LABEL[kind], { number: target.index + 1 });
    return t('admin.config.editor.problem_whole');
  };

  const listProps = {
    disabled: stale,
    invalidIndexes,
    problemsId: describedBy,
    onChange: (items: string[]) => setForm({ kind: form.kind as ListKind, items }),
    items: form.kind === 'sla' || form.kind === 'json' ? [] : form.items,
  };

  return (
    <>
      <div className={'admin-editor'} data-testid={'admin-config-editor'}>
        <h3 id={titleId} ref={heading} tabIndex={-1}>
          {t('admin.config.editor.title')}
        </h3>
        <p className={'small muted'}>{t('admin.config.editor.intro')}</p>
        {stale ? <p className={'notice'}>{t('admin.config.editor.stale_hint')}</p> : null}
        <form
          className={'admin-editor-form'}
          aria-labelledby={titleId}
          noValidate={true}
          onSubmit={(event) => {
            event.preventDefault();
            if (stale) return;
            if (body === undefined) {
              setStatus(undefined);
              setRefused(true);
              return;
            }
            void save(body, currentId, false);
          }}
        >
          {form.kind === 'json' ? (
            isJsonKind(kind) ? (
              <JsonEditor
                kind={kind}
                text={form.text}
                onChange={(text) => {
                  setRefused(false);
                  setForm({ kind: 'json', text });
                }}
                disabled={stale}
                invalid={targets.length > 0}
                refused={refused}
                problemsId={describedBy}
              />
            ) : null
          ) : form.kind === 'sla' ? (
            <SlaEditor
              values={form.values}
              onChange={(values) => setForm({ kind: 'sla', values })}
              disabled={stale}
              invalidLanes={invalidLanes}
              problemsId={describedBy}
            />
          ) : form.kind === 'calendar' ? (
            <CalendarEditor {...listProps} />
          ) : form.kind === 'operator_recipients' ? (
            <RecipientsEditor {...listProps} />
          ) : form.kind === 'checklist_templates' ? (
            <ListEditor
              {...listProps}
              legendKey={kindLabelKey}
              itemLabelKey={ITEM_LABEL.checklist_templates}
              addLabelKey={'admin.config.editor.add.checklist_templates'}
              hintKey={'admin.config.editor.templates_hint'}
            />
          ) : (
            <ListEditor
              {...listProps}
              legendKey={kindLabelKey}
              itemLabelKey={ITEM_LABEL.use_case_groups}
              addLabelKey={'admin.config.editor.add.use_case_groups'}
              hintKey={'admin.config.editor.groups_hint'}
            />
          )}
          {dirty && !stale && draft !== null ? (
            <p className={'small'}>{t('admin.config.editor.unsaved')}</p>
          ) : null}
          <div className={'admin-editor-actions'}>
            {stale ? (
              <button
                type={'button'}
                className={'btn btn-primary'}
                onClick={() => {
                  if (current !== null) void save(current.body, current.revisionId, true);
                }}
              >
                {t('admin.config.editor.start_again')}
              </button>
            ) : (
              <button type={'submit'} className={'btn btn-primary'} aria-disabled={busy}>
                {t('admin.config.editor.save')}
              </button>
            )}
            <button
              type={'button'}
              className={'btn btn-primary'}
              disabled={!publishable}
              aria-describedby={hintKey === undefined ? undefined : `${baseId}-publish-hint`}
              onClick={() => {
                if (draft === null) return;
                setStatus(undefined);
                setPublishTarget({
                  kind,
                  kindLabelKey,
                  expectedDraftVersion: draft.draftVersion,
                  expectedCurrentRevisionId: currentId,
                  draftNote: draft.changeNote,
                });
              }}
            >
              {t('admin.config.editor.publish')}
            </button>
            {draft === null ? null : (
              <button
                type={'button'}
                className={'btn btn-secondary'}
                onClick={() => {
                  setDiscardError(undefined);
                  setDiscardOpen(true);
                }}
              >
                {t('admin.config.editor.discard')}
              </button>
            )}
          </div>
          {hintKey === undefined ? null : (
            <p className={'field-hint'} id={`${baseId}-publish-hint`}>
              {t(hintKey)}
            </p>
          )}
        </form>
        <div role={'status'} className={'admin-status'}>
          {status === undefined ? null : (
            <p
              className={'notice notice-success'}
              data-testid={'admin-config-editor-status'}
              ref={statusRef}
              tabIndex={-1}
            >
              {t(status.key, status.params)}
            </p>
          )}
        </div>
        {error === undefined ? null : (
          <ErrorNotice error={error}>
            {error instanceof ApiError && error.code === 'stale_version' ? (
              <button type={'button'} className={'btn btn-secondary'} onClick={reloadFromEditor}>
                {t('action.reload')}
              </button>
            ) : null}
          </ErrorNotice>
        )}
        {draft === null ? null : (
          <section className={'admin-subsection'} aria-labelledby={`${problemsId}-title`}>
            <h4 id={`${problemsId}-title`}>{t('admin.config.editor.problems_title')}</h4>
            {targets.length === 0 ? (
              <p>{t('admin.config.editor.no_problems')}</p>
            ) : (
              <ul id={problemsId} className={'admin-problems'} data-testid={'admin-config-problems'}>
                {targets.map(({ problem, target }, index) => (
                  <li
                    key={`${problem.path}:${problem.messageKey}:${index.toString()}`}
                    data-path={problem.path}
                  >
                    <span className={'admin-strong'}>{fieldLabel(target, problem.path)}</span>
                    {': '}
                    {translateApiKey(t, problem.messageKey, problem.params)}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
      <PublishDialog
        target={publishTarget}
        onClose={() => setPublishTarget(undefined)}
        onReload={() => {
          setPublishTarget(undefined);
          onReload();
        }}
        onPublished={(published) => {
          setPublishTarget(undefined);
          onPublished(published);
        }}
      />
      <Dialog open={discardOpen} labelledBy={discardTitleId} onClose={() => setDiscardOpen(false)}>
        <h2 id={discardTitleId}>{t('admin.config.discard_dialog.title')}</h2>
        <p>{t('admin.config.discard_dialog.body')}</p>
        {discardError === undefined ? null : (
          <ErrorNotice error={discardError}>
            {discardError instanceof ApiError && discardError.code === 'stale_version' ? (
              <button
                type={'button'}
                className={'btn btn-secondary'}
                onClick={() => {
                  setDiscardOpen(false);
                  onReload();
                }}
              >
                {t('action.reload')}
              </button>
            ) : null}
          </ErrorNotice>
        )}
        <div className={'dialog-actions'}>
          <button type={'button'} className={'btn btn-secondary'} onClick={() => setDiscardOpen(false)}>
            {t('common.cancel')}
          </button>
          <button type={'button'} className={'btn btn-primary'} onClick={() => void discard()}>
            {t('admin.config.discard_dialog.confirm')}
          </button>
        </div>
      </Dialog>
    </>
  );
}
