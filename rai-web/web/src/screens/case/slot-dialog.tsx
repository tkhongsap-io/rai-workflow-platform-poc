// The slot editor dialog (W1-06): every W0-02 7.5 slot state is reachable from the keyboard, and a not-applicable
// choice cannot be applied without a typed reason (1..500 characters). It renders inside W1-07's shared Dialog
// (native <dialog> + showModal(): focus moves in onto the checked state radio, Tab wraps inside, focus returns to
// the invoking Change button on close, and Escape closes unless the reason field holds unsaved text, in which
// case the dialog asks first; section 9 item 3). Attaching uploads through 7.4 first (one `file` part); the slot
// then points at the returned artifactId.

import { useId, useRef, useState, type FormEvent, type JSX } from 'react';
import type { ArtifactRef } from '@rai/shared/schemas/artifacts';
import type { SlotNumber, SlotState } from '@rai/shared/schemas/pack';
import { api } from '../../api/client.js';
import { Dialog } from '../../components/dialog.js';
import { ErrorNotice } from '../../components/error-notice.js';
import { useLocale } from '../../i18n/locale-provider.js';
import {
  REASON_MAX_LENGTH,
  SLOT_STATE_ORDER,
  reasonIsValid,
  slotHelpKey,
  slotNameKey,
  slotStateKey,
  type SlotStateName,
} from './view-model.js';

const TITLE_ID = 'slot-dialog-title';
const ACCEPT = '.pdf,.docx,.xlsx,.png,.jpg,.jpeg';

export interface SlotDialogProps {
  caseId: string;
  /** The slot being edited; null when the dialog is closed. */
  slot: SlotNumber | null;
  current: SlotState | null;
  /** The metadata of the currently attached artifact, when known. */
  currentArtifact: ArtifactRef | undefined;
  onApply: (slot: SlotNumber, next: SlotState, artifact: ArtifactRef | undefined) => void;
  onClose: () => void;
}

export function SlotDialog({
  caseId,
  slot,
  current,
  currentArtifact,
  onApply,
  onClose,
}: SlotDialogProps): JSX.Element {
  const [dirty, setDirty] = useState(false);
  const close = (): void => {
    setDirty(false);
    onClose();
  };
  return (
    <Dialog
      open={slot !== null}
      labelledBy={TITLE_ID}
      onClose={close}
      hasUnsavedInput={dirty}
      className={'dialog-wide'}
    >
      {slot !== null && current !== null ? (
        <SlotForm
          key={slot}
          caseId={caseId}
          slot={slot}
          current={current}
          currentArtifact={currentArtifact}
          onDirtyChange={setDirty}
          onApply={(next, artifact) => {
            setDirty(false);
            onApply(slot, next, artifact);
          }}
          onCancel={close}
        />
      ) : null}
    </Dialog>
  );
}

interface SlotFormProps {
  caseId: string;
  slot: SlotNumber;
  current: SlotState;
  currentArtifact: ArtifactRef | undefined;
  /** Reports whether the reason field holds text that would be lost on close (the Dialog then asks on Escape). */
  onDirtyChange: (dirty: boolean) => void;
  onApply: (next: SlotState, artifact: ArtifactRef | undefined) => void;
  onCancel: () => void;
}

function SlotForm({
  caseId,
  slot,
  current,
  currentArtifact,
  onDirtyChange,
  onApply,
  onCancel,
}: SlotFormProps): JSX.Element {
  const { t } = useLocale();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ids = useId();
  const initialReason =
    current.state === 'not_applicable' && current.reason.kind === 'text' ? current.reason.text : '';
  const [state, setState] = useState<SlotStateName>(current.state);
  const [reason, setReason] = useState(initialReason);
  const [fileName, setFileName] = useState<string | null>(null);
  const [validation, setValidation] = useState<'reason_required' | 'file_required' | null>(null);
  const [apiError, setApiError] = useState<unknown>(null);
  const [uploading, setUploading] = useState(false);

  const choose = (nextState: SlotStateName, nextReason: string): void => {
    setState(nextState);
    setReason(nextReason);
    setValidation(null);
    onDirtyChange(nextState === 'not_applicable' && nextReason !== initialReason);
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setValidation(null);
    setApiError(null);
    if (state === 'not_yet' || state === 'missing') {
      onApply({ state }, undefined);
      return;
    }
    if (state === 'not_applicable') {
      if (!reasonIsValid(reason)) {
        setValidation('reason_required');
        reasonRef.current?.focus();
        return;
      }
      onApply({ state: 'not_applicable', reason: { kind: 'text', text: reason.trim() } }, undefined);
      return;
    }
    // attached
    const file = fileRef.current?.files?.[0];
    if (file === undefined) {
      if (current.state === 'attached') {
        onApply(current, currentArtifact);
        return;
      }
      setValidation('file_required');
      fileRef.current?.focus();
      return;
    }
    setUploading(true);
    try {
      const ref = await api.uploadArtifact(caseId, file);
      onApply({ state: 'attached', artifactId: ref.artifactId }, ref);
    } catch (err: unknown) {
      setApiError(err);
    } finally {
      setUploading(false);
    }
  };

  const reasonHintId = `${ids}-reason-hint`;
  const reasonErrorId = `${ids}-reason-error`;
  const fileErrorId = `${ids}-file-error`;
  const name = t(slotNameKey(slot));

  return (
    <form
      className={'slot-form'}
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <h2 id={TITLE_ID}>{t('slot.dialog.title', { number: slot, name })}</h2>

      <fieldset className={'field'}>
        <legend>{t('slot.dialog.state_legend')}</legend>
        {SLOT_STATE_ORDER.map((option) => (
          <label key={option} className={'slot-choice'}>
            <input
              type={'radio'}
              name={'slot-state'}
              value={option}
              checked={state === option}
              onChange={() => choose(option, reason)}
            />
            <span className={'slot-choice-label'}>{t(slotStateKey(option))}</span>
            <span className={'slot-choice-help'}>{t(slotHelpKey(option))}</span>
          </label>
        ))}
      </fieldset>

      {state === 'attached' ? (
        <div className={'field'}>
          <label htmlFor={`${ids}-file`}>
            {current.state !== 'attached' ? t('slot.dialog.file_required_label') : t('slot.dialog.file')}
          </label>
          {current.state === 'attached' && currentArtifact !== undefined ? (
            <p className={'field-hint'} id={`${ids}-file-keep`}>
              {t('slot.dialog.file_keep', { filename: currentArtifact.filename })}
            </p>
          ) : null}
          <input
            ref={fileRef}
            id={`${ids}-file`}
            type={'file'}
            accept={ACCEPT}
            aria-describedby={validation === 'file_required' ? fileErrorId : undefined}
            aria-invalid={validation === 'file_required'}
            onChange={(event) => {
              setFileName(event.currentTarget.files?.[0]?.name ?? null);
              setValidation(null);
            }}
          />
          {fileName !== null ? <p className={'field-hint'}>{fileName}</p> : null}
          {validation === 'file_required' ? (
            <p className={'field-error'} id={fileErrorId} role={'alert'}>
              {t('slot.dialog.file_required')}
            </p>
          ) : null}
        </div>
      ) : null}

      {state === 'not_applicable' ? (
        <div className={'field'}>
          <label htmlFor={`${ids}-reason`}>{t('slot.dialog.reason_label')}</label>
          {current.state === 'not_applicable' && current.reason.kind === 'default_non_vendor' ? (
            <p className={'field-hint'}>{t('slot.dialog.reason_default')}</p>
          ) : null}
          <textarea
            ref={reasonRef}
            id={`${ids}-reason`}
            rows={3}
            maxLength={REASON_MAX_LENGTH}
            value={reason}
            aria-required={true}
            aria-describedby={
              validation === 'reason_required' ? `${reasonHintId} ${reasonErrorId}` : reasonHintId
            }
            aria-invalid={validation === 'reason_required'}
            onChange={(event) => choose(state, event.currentTarget.value)}
          />
          <p className={'field-hint'} id={reasonHintId}>
            {t('slot.dialog.reason_hint')}
          </p>
          {validation === 'reason_required' ? (
            <p className={'field-error'} id={reasonErrorId} role={'alert'}>
              {t('validation.reason_required')}
            </p>
          ) : null}
        </div>
      ) : null}

      {apiError !== null ? (
        <ErrorNotice error={apiError}>
          <button type={'button'} className={'btn btn-ghost'} onClick={() => setApiError(null)}>
            {t('action.dismiss')}
          </button>
        </ErrorNotice>
      ) : null}

      <div className={'dialog-actions'}>
        <button type={'submit'} className={'btn btn-primary'} disabled={uploading}>
          {uploading ? t('slot.dialog.uploading') : t('slot.dialog.apply')}
        </button>
        <button type={'button'} className={'btn btn-secondary'} onClick={onCancel} disabled={uploading}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
