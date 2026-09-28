// W6-06 (W6 plan sections 2.1 and 9): a list of text values, one field per entry with Remove, and Add. Used for the
// use-case groups (D11), the checklist template versions, the operator recipients and the calendar's holidays.
// Nothing is refused here (Q18): the server lists what publishing would refuse, and a problem naming a row marks
// that row's field invalid. Add moves focus to the new field; Remove to the next field, or to Add.

import { useEffect, useId, useRef, type JSX } from 'react';
import type { LocaleKey } from '@rai/shared/locales/keys';
import { useLocale } from '../../../i18n/locale-provider.js';

export interface ListEditorProps {
  items: readonly string[];
  onChange: (items: string[]) => void;
  /** The group's legend (the kind's name). */
  legendKey: LocaleKey;
  /** "Holiday {number}" and the like: each field's label. */
  itemLabelKey: LocaleKey;
  addLabelKey: LocaleKey;
  hintKey?: LocaleKey;
  inputType?: 'text' | 'email' | 'date';
  disabled: boolean;
  /** Row indexes a served problem names. */
  invalidIndexes: ReadonlySet<number>;
  /** The id of the problem list, which describes an invalid field. */
  problemsId: string | undefined;
}

export function ListEditor({
  items,
  onChange,
  legendKey,
  itemLabelKey,
  addLabelKey,
  hintKey,
  inputType = 'text',
  disabled,
  invalidIndexes,
  problemsId,
}: ListEditorProps): JSX.Element {
  const { t } = useLocale();
  const baseId = useId();
  const hintId = `${baseId}-hint`;
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const addButton = useRef<HTMLButtonElement>(null);
  // Where focus goes after the render an Add or Remove causes (a ref: focus is not rendered state).
  const focusAt = useRef<number | 'add'>(undefined);

  useEffect(() => {
    const target = focusAt.current;
    if (target === undefined) return;
    focusAt.current = undefined;
    (target === 'add' ? addButton.current : (inputs.current[target] ?? addButton.current))?.focus();
  });

  const label = (index: number) => t(itemLabelKey, { number: index + 1 });
  return (
    <fieldset
      className={'admin-editor-fieldset'}
      aria-describedby={hintKey === undefined ? undefined : hintId}
    >
      <legend>{t(legendKey)}</legend>
      {hintKey === undefined ? null : (
        <p className={'field-hint'} id={hintId}>
          {t(hintKey)}
        </p>
      )}
      {items.length === 0 ? <p className={'muted small'}>{t('admin.config.editor.empty_list')}</p> : null}
      <ol className={'admin-editor-list'}>
        {items.map((item, index) => {
          const id = `${baseId}-item-${index.toString()}`;
          const invalid = invalidIndexes.has(index);
          return (
            <li key={index} className={'admin-editor-row'}>
              <label htmlFor={id}>{label(index)}</label>
              <div className={'admin-editor-row-controls'}>
                <input
                  id={id}
                  ref={(element) => {
                    inputs.current[index] = element;
                  }}
                  type={inputType}
                  value={item}
                  disabled={disabled}
                  aria-invalid={invalid}
                  aria-describedby={invalid ? problemsId : undefined}
                  autoComplete={'off'}
                  onChange={(event) => {
                    const next = [...items];
                    next[index] = event.target.value;
                    onChange(next);
                  }}
                />
                <button
                  type={'button'}
                  className={'btn btn-secondary btn-small'}
                  disabled={disabled}
                  aria-label={t('admin.config.editor.remove', { item: label(index) })}
                  onClick={() => {
                    focusAt.current = index < items.length - 1 ? index : 'add';
                    onChange(items.filter((_, i) => i !== index));
                  }}
                >
                  {t('admin.config.editor.remove_short')}
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <button
        type={'button'}
        ref={addButton}
        className={'btn btn-secondary btn-small'}
        disabled={disabled}
        onClick={() => {
          focusAt.current = items.length;
          onChange([...items, '']);
        }}
      >
        {t(addLabelKey)}
      </button>
    </fieldset>
  );
}
