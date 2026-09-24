// W1-07 (Lane B): the new-case form of W0-02 7.3 (POST /api/cases with a client-minted Idempotency-Key per
// attempt, W0-06 5.3). The use-case group list comes from GET /api/configuration/current (D11). The screen sends
// what the viewer typed and renders the server's answer: 201 → the list with a notice; 422 → the field errors on
// their inputs; 403 → the forbidden notice (a reviewer or Admin trying to create). No role check runs here.

import { useEffect, useId, useRef, useState, type FormEvent, type JSX } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MODEL_TYPES, type ConfigurationView, type ModelType } from '@rai/shared/schemas/cases';
import type { LocaleKey } from '@rai/shared/locales/keys';
import { ApiError, api } from '../../api/client.js';
import { ErrorNotice } from '../../components/error-notice.js';
import { useLocale } from '../../i18n/locale-provider.js';
import { useSignedInSession } from '../../session/session-provider.js';
import { ROUTES } from '../../routes.js';
import {
  blankFields,
  fieldMessagesFrom,
  initialForm,
  suggestedBusinessUnits,
  toCreateRequest,
  type FieldMessages,
  type NewCaseField,
  type NewCaseForm,
} from './new-case.view-model.js';

const MODEL_TYPE_KEY: Readonly<Record<ModelType, LocaleKey>> = Object.freeze({
  llm: 'model_type.llm',
  classic_ml: 'model_type.classic_ml',
  other: 'model_type.other',
});

type ConfigState =
  | { kind: 'loading' }
  | { kind: 'loaded'; configuration: ConfigurationView }
  | { kind: 'failed'; error: unknown };

function TextField({
  id,
  name,
  label,
  value,
  onChange,
  hint,
  error,
  required,
  list,
}: {
  id: string;
  name: NewCaseField;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string | undefined;
  error?: string | undefined;
  required?: boolean | undefined;
  list?: string | undefined;
}): JSX.Element {
  const { t } = useLocale();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint !== undefined ? hintId : null, error !== undefined ? errorId : null]
    .filter((v) => v !== null)
    .join(' ');
  return (
    <div className={'field'}>
      <label htmlFor={id}>
        {label}
        {required === true ? (
          <>
            {' '}
            <span className={'required-mark'} aria-hidden={true}>
              *
            </span>
            <span className={'visually-hidden'}>{t('common.required_marker')}</span>
          </>
        ) : null}
      </label>
      <input
        id={id}
        name={name}
        type={'text'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        aria-invalid={error !== undefined ? true : undefined}
        list={list}
        autoComplete={'off'}
      />
      {hint !== undefined ? (
        <p id={hintId} className={'field-hint'}>
          {hint}
        </p>
      ) : null}
      {error !== undefined ? (
        <p id={errorId} className={'field-error'}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function NewCaseScreen(): JSX.Element {
  const { t } = useLocale();
  const session = useSignedInSession();
  const navigate = useNavigate();
  const [config, setConfig] = useState<ConfigState>({ kind: 'loading' });
  const [form, setForm] = useState<NewCaseForm>(() => initialForm(session.principal));
  const [fieldErrors, setFieldErrors] = useState<FieldMessages>({});
  const [error, setError] = useState<unknown>(undefined);
  const [busy, setBusy] = useState(false);
  const idBase = useId();
  const summaryRef = useRef<HTMLDivElement>(null);
  const suggestions = suggestedBusinessUnits(session.principal);

  useEffect(() => {
    let cancelled = false;
    api
      .getConfiguration()
      .then((configuration) => {
        if (!cancelled) setConfig({ kind: 'loaded', configuration });
      })
      .catch((err: unknown) => {
        if (!cancelled) setConfig({ kind: 'failed', error: err });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const set = <K extends NewCaseField>(key: K, value: NewCaseForm[K]): void =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const fieldMessage = (field: NewCaseField): string | undefined => {
    const key = fieldErrors[field];
    return key === undefined ? undefined : t(key);
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setFieldErrors({});
    try {
      // One key per user action (W0-06 5.3): a retry after a 422 is a new action with a new body.
      const created = await api.createCase(toCreateRequest(form), crypto.randomUUID());
      void navigate(ROUTES.cases, { state: { createdRegistryId: created.registryId } });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_input') {
        const { fields, other } = fieldMessagesFrom(err.fieldErrors, blankFields(form));
        setFieldErrors(fields);
        setError(other.length > 0 || Object.keys(fields).length === 0 ? err : { summary: true });
      } else {
        setError(err);
      }
      queueMicrotask(() => summaryRef.current?.focus());
    } finally {
      setBusy(false);
    }
  };

  const id = (field: string): string => `${idBase}-${field}`;
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;

  return (
    <div style={{ maxWidth: 760 }}>
      <Link to={ROUTES.cases} className={'btn btn-ghost'}>
        {t('common.back_to_list')}
      </Link>
      <h1 style={{ marginTop: 12 }}>{t('new_case.title')}</h1>
      <p className={'lede'}>{t('new_case.intro')}</p>

      <div ref={summaryRef} tabIndex={-1} style={{ marginTop: 16 }}>
        {error !== undefined && !(typeof error === 'object' && error !== null && 'summary' in error) ? (
          <ErrorNotice error={error} />
        ) : null}
        {hasFieldErrors ? (
          <div className={'notice notice-error'} role={'alert'}>
            <p>
              <strong>{t('error.invalid_input')}</strong>
            </p>
            <p>{t('new_case.error_summary')}</p>
          </div>
        ) : null}
      </div>

      {config.kind === 'failed' ? <ErrorNotice error={config.error} /> : null}

      <form className={'card form-grid'} onSubmit={(event) => void submit(event)} noValidate={true}>
        <p className={'small muted'} style={{ margin: 0 }}>
          {t('common.required_hint')}
        </p>
        <TextField
          id={id('useCaseName')}
          name={'useCaseName'}
          label={t('field.use_case_name')}
          value={form.useCaseName}
          onChange={(v) => set('useCaseName', v)}
          error={fieldMessage('useCaseName')}
          required={true}
        />
        <div className={'form-row-2'}>
          <TextField
            id={id('businessUnitId')}
            name={'businessUnitId'}
            label={t('field.business_unit_id')}
            value={form.businessUnitId}
            onChange={(v) => set('businessUnitId', v)}
            hint={t('field.business_unit_id_hint')}
            error={fieldMessage('businessUnitId')}
            required={true}
            list={suggestions.length > 0 ? id('bu-list') : undefined}
          />
          <TextField
            id={id('businessUnit')}
            name={'businessUnit'}
            label={t('field.business_unit')}
            value={form.businessUnit}
            onChange={(v) => set('businessUnit', v)}
            error={fieldMessage('businessUnit')}
            required={true}
          />
        </div>
        {suggestions.length > 0 ? (
          <datalist id={id('bu-list')}>
            {suggestions.map((unit) => (
              <option key={unit} value={unit} />
            ))}
          </datalist>
        ) : null}
        <div className={'form-row-2'}>
          <TextField
            id={id('businessOwner')}
            name={'businessOwner'}
            label={t('field.business_owner')}
            value={form.businessOwner}
            onChange={(v) => set('businessOwner', v)}
            hint={t('field.business_owner_hint')}
            error={fieldMessage('businessOwner')}
            required={true}
          />
          <TextField
            id={id('technicalOwner')}
            name={'technicalOwner'}
            label={t('field.technical_owner')}
            value={form.technicalOwner}
            onChange={(v) => set('technicalOwner', v)}
            error={fieldMessage('technicalOwner')}
            required={true}
          />
        </div>

        <fieldset className={'field'} aria-describedby={id('source-hint')}>
          <legend>{t('field.source_record_id')}</legend>
          <label className={'choice'}>
            <input
              type={'radio'}
              name={'sourceKind'}
              value={'unknown'}
              checked={form.sourceKind === 'unknown'}
              onChange={() => set('sourceKind', 'unknown')}
            />
            <span>{t('field.source_unknown')}</span>
          </label>
          <label className={'choice'}>
            <input
              type={'radio'}
              name={'sourceKind'}
              value={'known'}
              checked={form.sourceKind === 'known'}
              onChange={() => set('sourceKind', 'known')}
            />
            <span>{t('field.source_known')}</span>
          </label>
          {form.sourceKind === 'known' ? (
            <div style={{ marginTop: 8 }}>
              <TextField
                id={id('sourceValue')}
                name={'sourceValue'}
                label={t('field.source_value')}
                value={form.sourceValue}
                onChange={(v) => set('sourceValue', v)}
                error={fieldMessage('sourceValue') ?? fieldMessage('sourceKind')}
                required={true}
              />
            </div>
          ) : null}
          <p id={id('source-hint')} className={'field-hint'}>
            {t('field.source_hint')}
          </p>
        </fieldset>

        <div className={'field'}>
          <label htmlFor={id('useCaseGroup')}>
            {t('field.use_case_group')}{' '}
            <span className={'required-mark'} aria-hidden={true}>
              *
            </span>
            <span className={'visually-hidden'}>{t('common.required_marker')}</span>
          </label>
          <select
            id={id('useCaseGroup')}
            name={'useCaseGroup'}
            value={form.useCaseGroup}
            onChange={(event) => set('useCaseGroup', event.target.value)}
            aria-invalid={fieldErrors.useCaseGroup !== undefined ? true : undefined}
            aria-describedby={fieldErrors.useCaseGroup !== undefined ? id('useCaseGroup-error') : undefined}
            disabled={config.kind !== 'loaded'}
          >
            <option value={''}>{config.kind === 'loading' ? t('common.loading') : t('field.choose')}</option>
            {config.kind === 'loaded'
              ? config.configuration.useCaseGroups.map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))
              : null}
          </select>
          {fieldErrors.useCaseGroup !== undefined ? (
            <p id={id('useCaseGroup-error')} className={'field-error'}>
              {t(fieldErrors.useCaseGroup)}
            </p>
          ) : null}
        </div>

        <div className={'form-row-2'}>
          <fieldset className={'field'} aria-describedby={id('vendor-hint')}>
            <legend>{t('field.vendor_involved')}</legend>
            <label className={'choice'}>
              <input
                type={'radio'}
                name={'vendorInvolved'}
                value={'no'}
                checked={form.vendorInvolved === 'no'}
                onChange={() => set('vendorInvolved', 'no')}
              />
              <span>{t('common.no')}</span>
            </label>
            <label className={'choice'}>
              <input
                type={'radio'}
                name={'vendorInvolved'}
                value={'yes'}
                checked={form.vendorInvolved === 'yes'}
                onChange={() => set('vendorInvolved', 'yes')}
              />
              <span>{t('common.yes')}</span>
            </label>
            <p id={id('vendor-hint')} className={'field-hint'}>
              {t('field.vendor_hint')}
            </p>
          </fieldset>
          <fieldset className={'field'}>
            <legend>{t('field.model_type')}</legend>
            {MODEL_TYPES.map((type) => (
              <label key={type} className={'choice'}>
                <input
                  type={'radio'}
                  name={'modelType'}
                  value={type}
                  checked={form.modelType === type}
                  onChange={() => set('modelType', type)}
                />
                <span>{t(MODEL_TYPE_KEY[type])}</span>
              </label>
            ))}
          </fieldset>
        </div>

        <div className={'form-actions'}>
          <button type={'submit'} className={'btn btn-primary'} disabled={busy}>
            {busy ? t('new_case.submitting') : t('new_case.submit')}
          </button>
          <Link to={ROUTES.cases} className={'btn btn-secondary'}>
            {t('common.cancel')}
          </Link>
        </div>
      </form>
    </div>
  );
}
