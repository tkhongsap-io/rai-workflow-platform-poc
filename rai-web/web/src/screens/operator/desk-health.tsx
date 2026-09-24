import { useEffect, useState, type JSX } from 'react';
import { api, InvalidResponseError } from '../../api/client.js';
import { ErrorNotice } from '../../components/error-notice.js';
import { useLocale } from '../../i18n/locale-provider.js';
import { useSession } from '../../session/session-provider.js';
import { DeskHealthSections } from './desk-health-sections.js';
import { isOperatorAdmin, visibleOperatorResult, type OperatorResult } from './desk-health.view-model.js';
import './desk-health.css';

export function DeskHealthScreen(): JSX.Element {
  const { state } = useSession();
  const { t } = useLocale();
  const session = state.status === 'signed_in' ? state.session : undefined;
  const admin = isOperatorAdmin(session);
  const [generation, setGeneration] = useState(0);
  const [result, setResult] = useState<OperatorResult>();
  const visible = visibleOperatorResult(result, session, generation);

  useEffect(() => {
    if (!admin || !session) return;
    let obsolete = false;
    void api.getDeskHealth().then(
      (report) => {
        if (!obsolete) setResult({ session, generation, kind: 'loaded', report });
      },
      (error: unknown) => {
        if (!obsolete) setResult({ session, generation, kind: 'failed', error });
      },
    );
    return () => {
      obsolete = true;
    };
  }, [admin, session, generation]);

  return (
    <div className={'operator-health'}>
      <h1>{t('operator.title')}</h1>
      {!admin ? (
        <p role={'alert'}>{t('error.forbidden')}</p>
      ) : (
        <>
          <p>{t('operator.description')}</p>
          <button
            type={'button'}
            className={'btn btn-secondary'}
            aria-disabled={!visible}
            onClick={() => {
              if (visible) setGeneration((value) => value + 1);
            }}
          >
            {t(visible?.kind === 'failed' ? 'common.retry' : 'operator.refresh')}
          </button>
          {!visible ? (
            <p role={'status'}>{t('common.loading')}</p>
          ) : visible.kind === 'failed' ? (
            visible.error instanceof InvalidResponseError ? (
              <p role={'alert'}>{t('operator.invalid_response')}</p>
            ) : (
              <ErrorNotice error={visible.error} />
            )
          ) : (
            <DeskHealthSections report={visible.report} />
          )}
        </>
      )}
    </div>
  );
}
