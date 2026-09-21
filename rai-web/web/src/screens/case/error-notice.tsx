// Renders a W0-06 8.2 envelope the way section 10.3 requires: the message key, the stale-version guidance key,
// the field keys and the correlation id, all through t(); never text from the server. A `refreshPath` (stale
// version) offers a reload of the current version. Nothing here interprets the error as a permission rule.

import type { JSX } from 'react';
import type { ErrorPresentation } from './view-model.js';
import { useApiT, useT } from './locale.js';

export interface ErrorNoticeProps {
  error: ErrorPresentation;
  onReload?: (() => void) | undefined;
  onDismiss?: (() => void) | undefined;
}

export function ErrorNotice({ error, onReload, onDismiss }: ErrorNoticeProps): JSX.Element {
  const t = useT();
  const ta = useApiT();
  return (
    <div className="rai-notice rai-notice--error" role="alert">
      <p className="rai-notice__title">{ta(error.messageKey)}</p>
      {error.guidanceKey !== null && <p>{ta(error.guidanceKey)}</p>}
      {error.fields.length > 0 && (
        <ul className="rai-notice__fields" aria-label={t('error.field_list')}>
          {error.fields.map((field) => (
            <li key={`${field.path}:${field.messageKey}`}>
              <code>{field.path}</code>
              {': '}
              {ta(field.messageKey, field.params)}
            </li>
          ))}
        </ul>
      )}
      <div className="rai-notice__actions">
        {onReload !== undefined && (
          <button type="button" className="rai-btn rai-btn--secondary" onClick={onReload}>
            {t('action.reload')}
          </button>
        )}
        {onDismiss !== undefined && (
          <button type="button" className="rai-btn rai-btn--ghost" onClick={onDismiss}>
            {t('action.dismiss')}
          </button>
        )}
        {error.correlationId !== null && (
          <span className="rai-muted">{t('error.correlation_id', { id: error.correlationId })}</span>
        )}
      </div>
    </div>
  );
}
