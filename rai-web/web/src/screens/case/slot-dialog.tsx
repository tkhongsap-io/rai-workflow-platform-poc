// The slot editor dialog (W1-06): every W0-02 7.5 slot state is reachable from the keyboard, and a not-applicable
// choice cannot be applied without a typed reason (1..500 characters). A native <dialog> with showModal() gives
// the section 9 item 3 behaviours: focus moves in on open, stays inside, returns to the invoking control on
// close, and Escape closes unless the reason field holds unsaved text, in which case the dialog asks first.
// Attaching uploads through 7.4 first (one `file` part); the slot then points at the returned artifactId.

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type JSX,
  type KeyboardEvent,
  type SyntheticEvent,
} from 'react';
import type { ArtifactRef } from '@rai/shared/schemas/artifacts';
import type { SlotNumber, SlotState } from '@rai/shared/schemas/pack';
import { ApiError, isApiError } from '../../api/client.js';
import { uploadArtifact } from '../../api/case.js';
import { ErrorNotice } from './error-notice.js';
import { useT } from './locale.js';
import {
  REASON_MAX_LENGTH,
  SLOT_STATE_ORDER,
  presentError,
  reasonIsValid,
  slotHelpKey,
  slotNameKey,
  slotStateKey,
  type ErrorPresentation,
  type SlotStateName,
} from './view-model.js';

export interface SlotDialogProps {
  caseId: string;
  slot: SlotNumber;
  current: SlotState;
  /** The metadata of the currently attached artifact, when known. */
  currentArtifact: ArtifactRef | undefined;
  onApply: (next: SlotState, artifact: ArtifactRef | undefined) => void;
  onClose: () => void;
}

const ACCEPT = '.pdf,.docx,.xlsx,.png,.jpg,.jpeg';
const FOCUSABLE = 'button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])';

export function SlotDialog({
  caseId,
  slot,
  current,
  currentArtifact,
  onApply,
  onClose,
}: SlotDialogProps): JSX.Element {
  const t = useT();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstRadioRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const discardRef = useRef<HTMLButtonElement>(null);
  const ids = useId();
  const initialReason =
    current.state === 'not_applicable' && current.reason.kind === 'text' ? current.reason.text : '';
  const [state, setState] = useState<SlotStateName>(current.state);
  const [reason, setReason] = useState(initialReason);
  const [fileName, setFileName] = useState<string | null>(null);
  const [validation, setValidation] = useState<'reason_required' | 'file_required' | null>(null);
  const [apiError, setApiError] = useState<ErrorPresentation | null>(null);
  const [uploading, setUploading] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null || dialog.open) return;
    dialog.showModal();
    // Focus moves into the dialog, onto the radio that reflects the slot's current state.
    const checked = dialog.querySelector<HTMLInputElement>('input[type="radio"]:checked');
    (checked ?? firstRadioRef.current)?.focus();
  }, []);

  // Section 9, item 3: focus is trapped inside. Chromium lets Tab leave a modal dialog for the browser UI
  // before cycling back, so Tab on the last focusable control and Shift+Tab on the first wrap explicitly.
  const trapFocus = (event: KeyboardEvent<HTMLDialogElement>): void => {
    if (event.key !== 'Tab') return;
    const dialog = event.currentTarget;
    const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (element) => !element.hasAttribute('disabled') && element.getClientRects().length > 0,
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) return;
    const active = document.activeElement;
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && (active === first || active === dialog)) {
      event.preventDefault();
      last.focus();
    }
  };

  useEffect(() => {
    if (askDiscard) discardRef.current?.focus();
  }, [askDiscard]);

  const reasonDirty = reason !== initialReason;

  const onCancelEvent = (event: SyntheticEvent<HTMLDialogElement>): void => {
    // Escape: the browser fires `cancel`; keep the dialog open and ask when the reason field holds unsaved text.
    if (reasonDirty && state === 'not_applicable') {
      event.preventDefault();
      setAskDiscard(true);
      return;
    }
    event.preventDefault();
    onClose();
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
      const ref = await uploadArtifact(caseId, file);
      onApply({ state: 'attached', artifactId: ref.artifactId }, ref);
    } catch (err: unknown) {
      const error: ApiError = isApiError(err)
        ? err
        : new ApiError({
            status: 0,
            code: 'network',
            messageKey: 'error.internal_error',
            correlationId: null,
            details: undefined,
          });
      setApiError(presentError(error));
    } finally {
      setUploading(false);
    }
  };

  const titleId = `${ids}-title`;
  const reasonHintId = `${ids}-reason-hint`;
  const reasonErrorId = `${ids}-reason-error`;
  const fileErrorId = `${ids}-file-error`;
  const name = t(slotNameKey(slot));

  return (
    <dialog
      ref={dialogRef}
      className="rai-dialog"
      aria-labelledby={titleId}
      onCancel={onCancelEvent}
      onClose={onClose}
      onKeyDown={trapFocus}
    >
      <form
        method="dialog"
        className="rai-dialog__form"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <h2 id={titleId} className="rai-dialog__title">
          {t('slot.dialog.title', { number: slot, name })}
        </h2>

        <fieldset className="rai-fieldset">
          <legend>{t('slot.dialog.state_legend')}</legend>
          {SLOT_STATE_ORDER.map((option, index) => (
            <label key={option} className="rai-radio">
              <input
                ref={index === 0 ? firstRadioRef : undefined}
                type="radio"
                name="slot-state"
                value={option}
                checked={state === option}
                onChange={() => {
                  setState(option);
                  setValidation(null);
                }}
              />
              <span className="rai-radio__label">{t(slotStateKey(option))}</span>
              <span className="rai-radio__help">{t(slotHelpKey(option))}</span>
            </label>
          ))}
        </fieldset>

        {state === 'attached' && (
          <div className="rai-field">
            <label htmlFor={`${ids}-file`} className="rai-field__label">
              {current.state !== 'attached' ? t('slot.dialog.file_required_label') : t('slot.dialog.file')}
            </label>
            {current.state === 'attached' && currentArtifact !== undefined && (
              <p className="rai-muted" id={`${ids}-file-keep`}>
                {t('slot.dialog.file_keep', { filename: currentArtifact.filename })}
              </p>
            )}
            <input
              ref={fileRef}
              id={`${ids}-file`}
              type="file"
              accept={ACCEPT}
              aria-describedby={validation === 'file_required' ? fileErrorId : undefined}
              aria-invalid={validation === 'file_required'}
              onChange={(event) => {
                setFileName(event.currentTarget.files?.[0]?.name ?? null);
                setValidation(null);
              }}
            />
            {fileName !== null && <p className="rai-muted">{fileName}</p>}
            {validation === 'file_required' && (
              <p className="rai-field__error" id={fileErrorId} role="alert">
                {t('slot.dialog.file_required')}
              </p>
            )}
          </div>
        )}

        {state === 'not_applicable' && (
          <div className="rai-field">
            <label htmlFor={`${ids}-reason`} className="rai-field__label">
              {t('slot.dialog.reason_label')}
            </label>
            {current.state === 'not_applicable' && current.reason.kind === 'default_non_vendor' && (
              <p className="rai-muted">{t('slot.dialog.reason_default')}</p>
            )}
            <textarea
              ref={reasonRef}
              id={`${ids}-reason`}
              rows={3}
              maxLength={REASON_MAX_LENGTH}
              value={reason}
              aria-required="true"
              aria-describedby={
                validation === 'reason_required' ? `${reasonHintId} ${reasonErrorId}` : reasonHintId
              }
              aria-invalid={validation === 'reason_required'}
              onChange={(event) => {
                setReason(event.currentTarget.value);
                setValidation(null);
              }}
            />
            <p className="rai-muted" id={reasonHintId}>
              {t('slot.dialog.reason_hint')}
            </p>
            {validation === 'reason_required' && (
              <p className="rai-field__error" id={reasonErrorId} role="alert">
                {t('validation.reason_required')}
              </p>
            )}
          </div>
        )}

        {apiError !== null && (
          <ErrorNotice
            error={apiError}
            onDismiss={() => {
              setApiError(null);
            }}
          />
        )}

        {askDiscard ? (
          <div className="rai-dialog__confirm" role="alertdialog" aria-labelledby={`${ids}-discard`}>
            <p id={`${ids}-discard`}>{t('slot.dialog.discard_prompt')}</p>
            <div className="rai-actions">
              <button ref={discardRef} type="button" className="rai-btn rai-btn--secondary" onClick={onClose}>
                {t('slot.dialog.discard_confirm')}
              </button>
              <button
                type="button"
                className="rai-btn rai-btn--ghost"
                onClick={() => {
                  setAskDiscard(false);
                  reasonRef.current?.focus();
                }}
              >
                {t('slot.dialog.discard_keep')}
              </button>
            </div>
          </div>
        ) : (
          <div className="rai-actions">
            <button type="submit" className="rai-btn rai-btn--primary" disabled={uploading}>
              {uploading ? t('slot.dialog.uploading') : t('slot.dialog.apply')}
            </button>
            <button
              type="button"
              className="rai-btn rai-btn--secondary"
              onClick={onClose}
              disabled={uploading}
            >
              {t('slot.dialog.cancel')}
            </button>
          </div>
        )}
      </form>
    </dialog>
  );
}
