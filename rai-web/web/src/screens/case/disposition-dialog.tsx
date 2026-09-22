// Disposition reason dialog (W2-09): waived and N/A require a reason (A09). Reuses the shared Dialog
// (native <dialog> + showModal()). One reason field, matching the send-back dialog's one-item pattern.
// Empty submit stays on the dialog with role=alert; Escape asks when the field is dirty.

import { useId, useState, type FormEvent, type JSX } from 'react';
import type { DispositionKind } from '@rai/shared/schemas/review';
import { Dialog } from '../../components/dialog.js';
import { useLocale } from '../../i18n/locale-provider.js';
import { DISPOSITION_REASON_MAX_LENGTH, dispositionKindKey, dispositionReasonIsValid } from './view-model.js';

const TITLE_ID = 'disposition-reason-dialog-title';

export interface DispositionDialogProps {
  open: boolean;
  kind: DispositionKind | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}

export function DispositionDialog({
  open,
  kind,
  busy,
  onClose,
  onSubmit,
}: DispositionDialogProps): JSX.Element {
  const [dirty, setDirty] = useState(false);
  const close = (): void => {
    setDirty(false);
    onClose();
  };
  return (
    <Dialog open={open} labelledBy={TITLE_ID} onClose={close} hasUnsavedInput={dirty}>
      {open && kind !== null ? (
        <DispositionReasonForm
          kind={kind}
          busy={busy}
          onDirtyChange={setDirty}
          onCancel={close}
          onSubmit={(reason) => {
            setDirty(false);
            onSubmit(reason);
          }}
        />
      ) : null}
    </Dialog>
  );
}

function DispositionReasonForm({
  kind,
  busy,
  onDirtyChange,
  onCancel,
  onSubmit,
}: {
  kind: DispositionKind;
  busy: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}): JSX.Element {
  const { t } = useLocale();
  const ids = useId();
  const [reason, setReason] = useState('');
  const [showValidation, setShowValidation] = useState(false);
  const valid = dispositionReasonIsValid(reason);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!valid) {
      setShowValidation(true);
      return;
    }
    onSubmit(reason.trim());
  };

  return (
    <form className={'slot-form'} onSubmit={submit} noValidate={true}>
      <h2 id={TITLE_ID}>{t('review.disposition.reason.title')}</h2>
      <p className={'muted'}>
        {t('review.disposition.reason.intro')} · {t(dispositionKindKey(kind))}
      </p>
      <div className={'field'}>
        <label htmlFor={`${ids}-reason`}>
          {t('review.disposition.reason.label')}{' '}
          <span className={'required-mark'} aria-hidden={true}>
            *
          </span>
        </label>
        <textarea
          id={`${ids}-reason`}
          rows={4}
          maxLength={DISPOSITION_REASON_MAX_LENGTH}
          required={true}
          aria-required={true}
          aria-invalid={showValidation && !valid}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            onDirtyChange(true);
            setShowValidation(false);
          }}
        />
      </div>
      {showValidation && !valid ? (
        <p className={'notice notice-error'} role={'alert'}>
          {t('review.disposition.reason.required')}
        </p>
      ) : null}
      <div className={'dialog-actions'}>
        <button type={'button'} className={'btn btn-ghost'} onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </button>
        <button type={'submit'} className={'btn btn-primary'} disabled={busy}>
          {busy ? t('review.disposition.reason.submitting') : t('review.disposition.reason.submit')}
        </button>
      </div>
    </form>
  );
}
