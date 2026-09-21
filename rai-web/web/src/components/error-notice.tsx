// W1-07 (Lane B): renders an API failure the way section 10 item 3 asks: the envelope's messageKey in the viewer's
// locale plus the correlation id for the operator; a NetworkError gets its own key. No text is ever taken from
// the response body.

import type { JSX } from 'react';
import { isLocaleKey } from '@rai/shared/locales/keys';
import { ApiError, NetworkError } from '../api/client.js';
import { useLocale } from '../i18n/locale-provider.js';

export function describeError(error: unknown): { messageKey: string; correlationId?: string } {
  if (error instanceof ApiError) {
    const out: { messageKey: string; correlationId?: string } = { messageKey: error.messageKey };
    if (error.correlationId !== undefined) out.correlationId = error.correlationId;
    return out;
  }
  if (error instanceof NetworkError) return { messageKey: 'common.network_error' };
  return { messageKey: 'error.internal_error' };
}

export function ErrorNotice({ error, id }: { error: unknown; id?: string }): JSX.Element {
  const { t } = useLocale();
  const { messageKey, correlationId } = describeError(error);
  const message = isLocaleKey(messageKey) ? t(messageKey) : messageKey;
  return (
    <div className={'notice notice-error'} role={'alert'} id={id} tabIndex={-1}>
      <p>
        <strong>{t('common.error_title')}</strong>
      </p>
      <p>{message}</p>
      {correlationId !== undefined ? (
        <p className={'small'}>{t('common.correlation_id', { correlationId })}</p>
      ) : null}
    </div>
  );
}
