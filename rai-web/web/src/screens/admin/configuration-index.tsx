// W6-05 (W6 plan sections 4.2 and 9, Q16): the Admin configuration index. One captioned table of every kind the
// server serves: whose decision its values are, the revision in force and any draft waiting. The page never decides
// access: it asks `GET /api/admin/configuration` and a non-Admin sees the server's 403 notice.

import { useEffect, useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import type { ConfigurationIndexResponse } from '@rai/shared/schemas/configuration-admin';
import { api, InvalidResponseError } from '../../api/client.js';
import { ErrorNotice } from '../../components/error-notice.js';
import { formatDateTime } from '../../i18n/format.js';
import { useLocale } from '../../i18n/locale-provider.js';
import { ROUTES } from '../../routes.js';
import { kindLabelKey, ownerLabelKey } from './configuration.view-model.js';
import './admin.css';

type Result = { kind: 'loaded'; data: ConfigurationIndexResponse } | { kind: 'failed'; error: unknown };

/** A failed Admin read: the schema refusal in words, anything else as the server's envelope (403, 404, 409 …). */
export function AdminLoadError({ error }: { error: unknown }): JSX.Element {
  const { t } = useLocale();
  if (error instanceof InvalidResponseError)
    return <p role={'alert'}>{t('admin.config.invalid_response')}</p>;
  return <ErrorNotice error={error} />;
}

export function ConfigurationIndexScreen(): JSX.Element {
  const { t, locale } = useLocale();
  const [result, setResult] = useState<Result>();

  useEffect(() => {
    let obsolete = false;
    void api.getConfigurationIndex().then(
      (data) => {
        if (!obsolete) setResult({ kind: 'loaded', data });
      },
      (error: unknown) => {
        if (!obsolete) setResult({ kind: 'failed', error });
      },
    );
    return () => {
      obsolete = true;
    };
  }, []);

  return (
    <div className={'admin-config'}>
      <h1>{t('admin.config.title')}</h1>
      {result === undefined ? (
        <p role={'status'}>{t('common.loading')}</p>
      ) : result.kind === 'failed' ? (
        <AdminLoadError error={result.error} />
      ) : (
        <>
          <p className={'lede'}>{t('admin.config.description')}</p>
          <div
            className={'admin-table'}
            role={'region'}
            aria-labelledby={'admin-config-index-caption'}
            tabIndex={0}
          >
            <table data-testid={'admin-config-index'}>
              <caption id={'admin-config-index-caption'}>{t('admin.config.index.caption')}</caption>
              <thead>
                <tr>
                  <th scope={'col'}>{t('admin.config.column.kind')}</th>
                  <th scope={'col'}>{t('admin.config.column.owner')}</th>
                  <th scope={'col'}>{t('admin.config.column.current')}</th>
                  <th scope={'col'}>{t('admin.config.column.draft')}</th>
                </tr>
              </thead>
              <tbody>
                {result.data.kinds.map((entry) => {
                  const labelKey = kindLabelKey(entry.kind);
                  return (
                    <tr key={entry.kind} data-kind={entry.kind}>
                      <th scope={'row'} data-col={'kind'}>
                        <Link to={ROUTES.adminConfigurationKind(entry.kind)}>
                          {labelKey === undefined ? entry.kind : t(labelKey)}
                        </Link>
                      </th>
                      <td>
                        <span className={`admin-owner admin-owner-${entry.valuesOwner}`} data-col={'owner'}>
                          {t(ownerLabelKey(entry.valuesOwner))}
                        </span>
                      </td>
                      <td data-col={'current'}>
                        {entry.current === null ? (
                          <span className={'muted'}>{t('admin.config.not_published')}</span>
                        ) : (
                          <>
                            <span className={'admin-strong'}>
                              {t('admin.config.revision_number', {
                                number: entry.current.revisionNumber,
                              })}
                            </span>
                            <span className={'small muted admin-block'}>
                              {formatDateTime(locale, entry.current.publishedAt)}
                            </span>
                          </>
                        )}
                        {entry.editable ? null : (
                          <span className={'small muted admin-block'}>{t('admin.config.not_editable')}</span>
                        )}
                      </td>
                      <td data-col={'draft'}>
                        {entry.draft === null ? (
                          <span className={'muted'}>{t('admin.config.draft.none')}</span>
                        ) : (
                          <>
                            <span className={'admin-block'}>
                              {t('admin.config.draft.saved', {
                                updatedAt: formatDateTime(locale, entry.draft.updatedAt),
                              })}
                            </span>
                            <span className={'small muted admin-block'}>
                              {t('admin.config.draft.problems', { count: entry.draft.problemCount })}
                            </span>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
