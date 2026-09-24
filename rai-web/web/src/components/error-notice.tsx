// Renders an API failure only through locale keys from the error envelope, plus its correlation id; no response
// text is shown and nothing here treats an error as a permission rule.

import type { JSX, ReactNode } from 'react';
import type { FieldError } from '@rai/shared/errors';
import { ApiError, NetworkError } from '../api/client.js';
import { translateApiKey, useLocale } from '../i18n/locale-provider.js';

export interface ErrorDescription {
  messageKey: string;
  correlationId?: string;
  /** W0-06 8.2 `stale_version.guidanceKey`, when the error is a 409. */
  guidanceKey?: string;
  /** W0-06 8.2 `stale_version.refreshPath`: the SPA path of the current version. */
  refreshPath?: string;
  /** W0-08 section 5: why an upload was refused, with the limit it broke. */
  reasonKey?: string;
  reasonParams?: Record<string, string | number>;
  fields: FieldError[];
}

export function describeError(error: unknown): ErrorDescription {
  if (error instanceof ApiError) {
    const out: ErrorDescription = { messageKey: error.messageKey, fields: error.fieldErrors };
    if (error.correlationId !== undefined) out.correlationId = error.correlationId;
    const stale = error.stale;
    if (stale !== undefined) {
      out.guidanceKey = stale.guidanceKey;
      out.refreshPath = stale.refreshPath;
    }
    const unsafe = error.unsafeUpload;
    if (unsafe !== undefined) {
      out.reasonKey = unsafe.reasonKey;
      if (unsafe.params !== undefined) out.reasonParams = unsafe.params;
    }
    return out;
  }
  if (error instanceof NetworkError) return { messageKey: 'common.network_error', fields: [] };
  return { messageKey: 'error.internal_error', fields: [] };
}

export function ErrorNotice({
  error,
  id,
  children,
}: {
  error: unknown;
  id?: string;
  /** Actions offered with the notice, such as reload after a stale version or dismiss. */
  children?: ReactNode;
}): JSX.Element {
  const { t } = useLocale();
  const { messageKey, correlationId, guidanceKey, reasonKey, reasonParams, fields } = describeError(error);
  return (
    <div className={'notice notice-error'} role={'alert'} id={id} tabIndex={-1}>
      <p>
        <strong>{t('common.error_title')}</strong>
      </p>
      <p>{translateApiKey(t, messageKey)}</p>
      {reasonKey !== undefined ? <p>{translateApiKey(t, reasonKey, reasonParams)}</p> : null}
      {guidanceKey !== undefined ? <p>{translateApiKey(t, guidanceKey)}</p> : null}
      {fields.length > 0 ? (
        <ul aria-label={t('error.field_list')}>
          {fields.map((field) => (
            <li key={`${field.path}:${field.messageKey}`}>
              <code>{field.path}</code>
              {': '}
              {translateApiKey(t, field.messageKey, field.params)}
            </li>
          ))}
        </ul>
      ) : null}
      {correlationId !== undefined ? (
        <p className={'small'}>{t('common.correlation_id', { correlationId })}</p>
      ) : null}
      {children !== undefined && children !== null ? (
        <div className={'notice-actions'}>{children}</div>
      ) : null}
    </div>
  );
}
