// Send-back feedback dialog (W2-07): names at least one artifact slot with a deficiency (A09). Reuses W1-07's
// Dialog (native <dialog> + showModal()). The form cannot submit until a slot is named and the deficiency is
// non-empty; an empty submit stays on the dialog (section 9 item 3 + A09).

import { useId, useState, type FormEvent, type JSX } from 'react';
import type { SlotNumber } from '@rai/shared/schemas/pack';
import type { SendBackFeedback } from '@rai/shared/schemas/review';
import { Dialog } from '../../components/dialog.js';
import { useLocale } from '../../i18n/locale-provider.js';
import { SLOT_NUMBERS, sendBackFeedbackIsValid, slotNameKey } from './view-model.js';

const TITLE_ID = 'send-back-dialog-title';

export interface SendBackDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (feedback: SendBackFeedback) => void;
  busy: boolean;
}

export function SendBackDialog({ open, onClose, onSubmit, busy }: SendBackDialogProps): JSX.Element {
  const [dirty, setDirty] = useState(false);
  const close = (): void => {
    setDirty(false);
    onClose();
  };
  return (
    <Dialog
      open={open}
      labelledBy={TITLE_ID}
      onClose={close}
      hasUnsavedInput={dirty}
      className={'dialog-wide'}
    >
      {open ? (
        <SendBackForm
          busy={busy}
          onDirtyChange={setDirty}
          onCancel={close}
          onSubmit={(feedback) => {
            setDirty(false);
            onSubmit(feedback);
          }}
        />
      ) : null}
    </Dialog>
  );
}

function SendBackForm({
  busy,
  onDirtyChange,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onCancel: () => void;
  onSubmit: (feedback: SendBackFeedback) => void;
}): JSX.Element {
  const { t } = useLocale();
  const ids = useId();
  const [slot, setSlot] = useState<SlotNumber | ''>('');
  const [deficiency, setDeficiency] = useState('');
  const [summary, setSummary] = useState('');
  const [showValidation, setShowValidation] = useState(false);

  const valid = sendBackFeedbackIsValid(slot === '' ? [] : [{ slot, deficiency: deficiency.trim() }]);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!valid) {
      setShowValidation(true);
      return;
    }
    const feedback = {
      items: [{ slot: slot as SlotNumber, deficiency: deficiency.trim() }],
      ...(summary.trim() === '' ? {} : { summary: summary.trim() }),
    } as SendBackFeedback;
    onSubmit(feedback);
  };

  return (
    <form className={'slot-form'} onSubmit={submit} noValidate={true}>
      <h2 id={TITLE_ID}>{t('review.send_back.title')}</h2>
      <p className={'muted'}>{t('review.send_back.intro')}</p>
      <div className={'field'}>
        <label htmlFor={`${ids}-slot`}>
          {t('review.send_back.slot_label')}{' '}
          <span className={'required-mark'} aria-hidden={true}>
            *
          </span>
        </label>
        <select
          id={`${ids}-slot`}
          value={slot === '' ? '' : String(slot)}
          required={true}
          aria-required={true}
          aria-invalid={showValidation && slot === ''}
          onChange={(event) => {
            const value = event.target.value;
            setSlot(value === '' ? '' : (Number(value) as SlotNumber));
            onDirtyChange(true);
            setShowValidation(false);
          }}
        >
          <option value={''}>{t('field.choose')}</option>
          {SLOT_NUMBERS.map((n) => (
            <option key={n} value={n}>
              {t('review.send_back.slot_option', { number: n, name: t(slotNameKey(n)) })}
            </option>
          ))}
        </select>
      </div>
      <div className={'field'}>
        <label htmlFor={`${ids}-deficiency`}>
          {t('review.send_back.deficiency_label')}{' '}
          <span className={'required-mark'} aria-hidden={true}>
            *
          </span>
        </label>
        <textarea
          id={`${ids}-deficiency`}
          rows={4}
          maxLength={2000}
          required={true}
          aria-required={true}
          aria-invalid={showValidation && deficiency.trim() === ''}
          value={deficiency}
          onChange={(event) => {
            setDeficiency(event.target.value);
            onDirtyChange(true);
            setShowValidation(false);
          }}
        />
      </div>
      <div className={'field'}>
        <label htmlFor={`${ids}-summary`}>{t('review.send_back.summary_label')}</label>
        <textarea
          id={`${ids}-summary`}
          rows={2}
          maxLength={2000}
          value={summary}
          onChange={(event) => {
            setSummary(event.target.value);
            onDirtyChange(true);
          }}
        />
      </div>
      {showValidation && !valid ? (
        <p className={'notice notice-error'} role={'alert'}>
          {t('review.send_back.slot_required')}
        </p>
      ) : null}
      <div className={'dialog-actions'}>
        <button type={'button'} className={'btn btn-ghost'} onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </button>
        <button type={'submit'} className={'btn btn-primary'} disabled={busy}>
          {busy ? t('review.send_back.submitting') : t('review.send_back.submit')}
        </button>
      </div>
    </form>
  );
}
