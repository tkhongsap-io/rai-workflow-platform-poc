// W6-06 (W6 plan section 2.1): SLA working days per lane (D01 seed: DPO 3, the others 5). Three number fields; the
// 1-60 range is a hint, never enforced by the browser, because a draft may hold any value (Q18) and the server
// lists what publishing would refuse (`SlaBodySchema`).

import { useId, type JSX } from 'react';
import { useLocale } from '../../../i18n/locale-provider.js';
import { SLA_LANES, type SlaLane } from './simple-kinds.js';

export function SlaEditor({
  values,
  onChange,
  disabled,
  invalidLanes,
  problemsId,
}: {
  values: Readonly<Record<SlaLane, string>>;
  onChange: (values: Record<SlaLane, string>) => void;
  disabled: boolean;
  invalidLanes: ReadonlySet<SlaLane>;
  problemsId: string | undefined;
}): JSX.Element {
  const { t } = useLocale();
  const baseId = useId();
  const hintId = `${baseId}-hint`;
  return (
    <fieldset className={'admin-editor-fieldset'} aria-describedby={hintId}>
      <legend>{t('admin.config.editor.sla_legend')}</legend>
      <p className={'field-hint'} id={hintId}>
        {t('admin.config.editor.sla_hint')}
      </p>
      <div className={'admin-editor-sla'}>
        {SLA_LANES.map((lane) => {
          const id = `${baseId}-${lane}`;
          const invalid = invalidLanes.has(lane);
          return (
            <div className={'field'} key={lane}>
              <label htmlFor={id}>{t(`lane.${lane}`)}</label>
              <input
                id={id}
                type={'number'}
                inputMode={'numeric'}
                min={1}
                max={60}
                step={1}
                value={values[lane]}
                disabled={disabled}
                aria-invalid={invalid}
                aria-describedby={invalid && problemsId !== undefined ? `${hintId} ${problemsId}` : hintId}
                onChange={(event) => onChange({ ...values, [lane]: event.target.value })}
              />
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
