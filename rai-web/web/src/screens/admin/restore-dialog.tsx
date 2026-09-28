// W6-05 (W6 plan sections 1.2 Q3 and 2.3): restore an earlier revision. The server publishes a copy of its body as
// the next revision with `restores_id` set; history stays forward-only. A person's restore always carries a change
// note of 1-500 characters, checked here before any request and again by the server. The request names the revision
// in force the page showed, so a page that is out of date gets the 409 `configuration_changed` guidance and a reload.

import { useCallback, useId, useState, type JSX } from 'react';
import {
  CHANGE_NOTE_MAX_LENGTH,
  type ConfigurationRevisionSummary,
} from '@rai/shared/schemas/configuration-admin';
import { api, ApiError } from '../../api/client.js';
import { Dialog } from '../../components/dialog.js';
import { ErrorNotice } from '../../components/error-notice.js';
import { useLocale } from '../../i18n/locale-provider.js';
import { changeNoteOf } from './configuration.view-model.js';

export interface RestoreTarget {
  kind: string;
  revision: Pick<ConfigurationRevisionSummary, 'revisionId' | 'revisionNumber'>;
  /** The revision in force the page shows; the server refuses the restore with 409 when it has moved. */
  expectedCurrentRevisionId: string;
}

export function RestoreDialog({
  target,
  onClose,
  onRestored,
  onReload,
}: {
  target: RestoreTarget | undefined;
  onClose: () => void;
  onRestored: (restored: ConfigurationRevisionSummary, from: number) => void;
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

  // Each opening starts clean: state is reset while rendering a new target (React's "adjust state on a prop change"),
  // so the dialog itself stays mounted and its close still returns focus to the control that opened it.
  const [shown, setShown] = useState(target);
  if (shown !== target) {
    setShown(target);
    setNote('');
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
      const restored = await api.restoreConfigurationRevision(target.kind, target.revision.revisionId, {
        expectedCurrentRevisionId: target.expectedCurrentRevisionId,
        changeNote,
      });
      setBusy(false);
      onRestored(restored, target.revision.revisionNumber);
    } catch (err) {
      setBusy(false);
      setError(err);
    }
  };

  const stale = error instanceof ApiError && error.code === 'stale_version';
  const number = target?.revision.revisionNumber ?? 0;
  const errorId = `${noteId}-error`;
  const countId = `${noteId}-count`;
  return (
    <Dialog open={target !== undefined} labelledBy={titleId} onClose={close} hasUnsavedInput={note !== ''}>
      <h2 id={titleId}>{t('admin.config.restore_dialog.title', { number })}</h2>
      <p>{t('admin.config.restore_dialog.body', { number })}</p>
      <p className={'muted'}>{t('admin.config.applies_note')}</p>
      <div className={'field'}>
        <label htmlFor={noteId}>{t('admin.config.restore_dialog.note_label')}</label>
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
          {t('admin.config.restore_dialog.note_count', {
            count: note.length,
            max: CHANGE_NOTE_MAX_LENGTH,
          })}
        </p>
        {noteRefused ? (
          <p className={'field-error'} id={errorId}>
            {t('admin.config.restore_dialog.note_required')}
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
          {t('admin.config.restore_dialog.confirm')}
        </button>
      </div>
    </Dialog>
  );
}
