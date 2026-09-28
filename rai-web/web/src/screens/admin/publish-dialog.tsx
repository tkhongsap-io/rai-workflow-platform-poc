// W6-06 (W6 plan sections 1.2 Q4/Q5 and 2.3): publish a kind's draft as its next revision. A person's publish always
// carries a change note of 1-500 characters (prefilled with the draft's note when it has one), checked here before
// any request and again by the server. The request names the draft version and the revision in force the page
// showed, so a page that is out of date gets the 409 `configuration_changed` guidance and a Reload; a refused body
// gets its field list.

import { useCallback, useId, useState, type JSX } from 'react';
import {
  CHANGE_NOTE_MAX_LENGTH,
  type ConfigurationRevisionSummary,
} from '@rai/shared/schemas/configuration-admin';
import type { LocaleKey } from '@rai/shared/locales/keys';
import { api, ApiError } from '../../api/client.js';
import { Dialog } from '../../components/dialog.js';
import { ErrorNotice } from '../../components/error-notice.js';
import { useLocale } from '../../i18n/locale-provider.js';
import { changeNoteOf } from './configuration.view-model.js';

export interface PublishTarget {
  kind: string;
  kindLabelKey: LocaleKey;
  expectedDraftVersion: number;
  /** The revision in force the page shows (null before any publish). */
  expectedCurrentRevisionId: string | null;
  /** The draft's own change note, offered as the starting text. */
  draftNote: string | null;
}

export function PublishDialog({
  target,
  onClose,
  onPublished,
  onReload,
}: {
  target: PublishTarget | undefined;
  onClose: () => void;
  onPublished: (published: ConfigurationRevisionSummary) => void;
  /** After a 409: reload the page's data (the dialog closes). */
  onReload: () => void;
}): JSX.Element {
  const { t } = useLocale();
  const titleId = useId();
  const noteId = useId();
  const [note, setNote] = useState('');
  const [noteRefused, setNoteRefused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();

  // Each opening starts clean (as the restore dialog): state is reset while rendering a new target.
  const [shown, setShown] = useState(target);
  if (shown !== target) {
    setShown(target);
    setNote(target?.draftNote ?? '');
    setNoteRefused(false);
    setBusy(false);
    setError(undefined);
  }

  const close = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  const confirm = async (): Promise<void> => {
    if (target === undefined) return;
    const changeNote = changeNoteOf(note);
    if (changeNote === undefined) {
      setNoteRefused(true);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const published = await api.publishConfigurationDraft(target.kind, {
        expectedDraftVersion: target.expectedDraftVersion,
        expectedCurrentRevisionId: target.expectedCurrentRevisionId,
        changeNote,
      });
      setBusy(false);
      onPublished(published);
    } catch (err) {
      setBusy(false);
      setError(err);
    }
  };

  const stale = error instanceof ApiError && error.code === 'stale_version';
  const errorId = `${noteId}-error`;
  const countId = `${noteId}-count`;
  return (
    <Dialog
      open={target !== undefined}
      labelledBy={titleId}
      onClose={close}
      hasUnsavedInput={note !== (target?.draftNote ?? '')}
    >
      <h2 id={titleId}>
        {t('admin.config.publish_dialog.title', {
          kind: target === undefined ? '' : t(target.kindLabelKey),
        })}
      </h2>
      <p>{t('admin.config.publish_dialog.body')}</p>
      <p className={'muted'}>{t('admin.config.applies_note')}</p>
      <div className={'field'}>
        <label htmlFor={noteId}>{t('admin.config.publish_dialog.note_label')}</label>
        <textarea
          id={noteId}
          value={note}
          maxLength={CHANGE_NOTE_MAX_LENGTH}
          required={true}
          aria-invalid={noteRefused}
          aria-describedby={noteRefused ? `${errorId} ${countId}` : countId}
          onChange={(event) => {
            setNote(event.target.value);
            if (noteRefused && changeNoteOf(event.target.value) !== undefined) setNoteRefused(false);
          }}
        />
        <p className={'field-hint'} id={countId}>
          {t('admin.config.publish_dialog.note_count', { count: note.length, max: CHANGE_NOTE_MAX_LENGTH })}
        </p>
        {noteRefused ? (
          <p className={'field-error'} id={errorId}>
            {t('admin.config.publish_dialog.note_required')}
          </p>
        ) : null}
      </div>
      {error !== undefined ? (
        <ErrorNotice error={error}>
          {stale ? (
            <button type={'button'} className={'btn btn-secondary'} onClick={onReload}>
              {t('action.reload')}
            </button>
          ) : null}
        </ErrorNotice>
      ) : null}
      <div className={'dialog-actions'}>
        <button type={'button'} className={'btn btn-secondary'} onClick={close} disabled={busy}>
          {t('common.cancel')}
        </button>
        <button type={'button'} className={'btn btn-primary'} onClick={() => void confirm()} disabled={busy}>
          {t('admin.config.publish_dialog.confirm')}
        </button>
      </div>
    </Dialog>
  );
}
