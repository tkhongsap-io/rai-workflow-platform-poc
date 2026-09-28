// W6-11 (W6 plan sections 1.2 Q16 and 6): the schema-validated JSON editor, for the kinds in `JSON_KINDS` (the
// identity group mapping; W6-12 adds the risk rubric). One labelled text area holding the whole body as JSON. Text
// that is not a JSON object is refused here and never sent; everything else is the server's: a save lists what
// publishing would refuse (`publishProblems`), by pointer. For the identity mapping, a warning says when it applies:
// read once at start by organisation sign-in (`network` with the `ad` source, and `production`), ignored by `fixture`,
// `local-google` and the `network` allow-list; publishing needs no redeploy but a restart (identity adapter 9.2).

import { useId, type JSX } from 'react';
import type { LocaleKey } from '@rai/shared/locales/keys';
import { useLocale } from '../../../i18n/locale-provider.js';
import type { JsonKind } from './json-kinds.js';

/** The warning each JSON kind shows above its field. */
const WARNING: Readonly<Record<JsonKind, LocaleKey>> = Object.freeze({
  group_role_mapping: 'admin.config.editor.identity_mapping_warning',
});

export function JsonEditor({
  kind,
  text,
  onChange,
  disabled,
  invalid,
  refused,
  problemsId,
}: {
  kind: JsonKind;
  text: string;
  onChange: (text: string) => void;
  disabled: boolean;
  /** The server listed a problem for the saved draft. */
  invalid: boolean;
  /** The last save was refused here: the text is not a JSON object. */
  refused: boolean;
  problemsId: string | undefined;
}): JSX.Element {
  const { t } = useLocale();
  const baseId = useId();
  const fieldId = `${baseId}-json`;
  const hintId = `${baseId}-hint`;
  const warningId = `${baseId}-warning`;
  const refusedId = `${baseId}-refused`;
  const describedBy = [
    warningId,
    hintId,
    ...(refused ? [refusedId] : []),
    ...(invalid && problemsId !== undefined ? [problemsId] : []),
  ].join(' ');
  return (
    <div className={'admin-editor-json'}>
      <p className={'notice'} id={warningId} data-testid={'admin-config-json-warning'}>
        {t(WARNING[kind])}
      </p>
      <div className={'field'}>
        <label className={'field-label'} htmlFor={fieldId}>
          {t('admin.config.editor.json_label')}
        </label>
        <textarea
          id={fieldId}
          className={'admin-json-text'}
          value={text}
          rows={16}
          spellCheck={false}
          autoCapitalize={'off'}
          autoCorrect={'off'}
          disabled={disabled}
          aria-invalid={invalid || refused}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
        <p className={'field-hint'} id={hintId}>
          {t('admin.config.editor.json_hint')}
        </p>
        {refused ? (
          <p
            className={'field-error'}
            id={refusedId}
            role={'alert'}
            data-testid={'admin-config-json-invalid'}
          >
            {t('admin.config.editor.json_invalid')}
          </p>
        ) : null}
      </div>
    </div>
  );
}
