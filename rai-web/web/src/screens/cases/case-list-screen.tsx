// W1-07 (Lane B): the viewer's scoped case list (W0-02 7.3 GET /api/cases). The server decides scope: the screen
// renders `items` as returned and never filters by role on the client (A01 browser row of section 8.2: each
// fixture user's list shows only in-scope cases; out-of-scope cases are absent because the server left them out).
// Cards follow the handoff: case identity, submission version and next action prominent; status as text + icon.
// The full queue with search, filters and counts arrives in W3-02.

import { useEffect, useState, type JSX } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { CASE_LIST_DEFAULTS, type CaseListResponse } from '@rai/shared/schemas/cases';
import { api } from '../../api/client.js';
import { ErrorNotice } from '../../components/error-notice.js';
import { StatusBadge } from '../../components/status-badge.js';
import { formatDateTime } from '../../i18n/format.js';
import { useLocale } from '../../i18n/locale-provider.js';
import { useSignedInSession } from '../../session/session-provider.js';
import { ROUTES } from '../../routes.js';
import { canCreateCase } from '../operator/desk-health.view-model.js';
import { pageCount, scopeLineFor, toRowModel, type CaseRowModel } from './case-list.view-model.js';

/** `key` names the request (page and reload counter) a result belongs to; a stale key means "loading". */
type ListResult =
  | { key: string; kind: 'loaded'; response: CaseListResponse }
  | { key: string; kind: 'failed'; error: unknown };

function CaseCard({ row }: { row: CaseRowModel }): JSX.Element {
  const { t, locale } = useLocale();
  const titleId = `case-${row.caseId}-title`;
  return (
    <li>
      <article className={'case-card'} aria-labelledby={titleId} data-registry-id={row.registryId}>
        <div className={'case-card-head'}>
          <div>
            <div className={'eyebrow'}>{row.registryId}</div>
            <h2 id={titleId}>{row.useCaseName}</h2>
          </div>
          <StatusBadge status={row.status} />
        </div>
        <dl className={'case-facts'}>
          <div>
            <dt>{t('cases.business_unit')}</dt>
            <dd>{row.businessUnitLabel}</dd>
          </div>
          <div>
            <dt>{t('cases.use_case_group')}</dt>
            <dd>{row.useCaseGroup}</dd>
          </div>
          <div>
            <dt>{t('cases.owner')}</dt>
            <dd>{row.ownerLabel}</dd>
          </div>
          <div>
            <dt>{t('cases.submission')}</dt>
            <dd className={'case-version'}>
              {row.versionNumber === null
                ? t('cases.version_none')
                : t('cases.version_number', { versionNumber: row.versionNumber })}
            </dd>
          </div>
        </dl>
        <div className={'case-card-foot'}>
          <div>
            <div className={'small'}>
              <strong>{t('cases.next_action', { action: t(row.nextActionKey) })}</strong>
            </div>
            <div className={'small muted'}>
              {t('cases.updated_at', { when: formatDateTime(locale, row.updatedAt) })}
            </div>
          </div>
          <Link
            to={ROUTES.case(row.caseId)}
            className={'btn btn-secondary'}
            aria-label={t('cases.open_named', { registryId: row.registryId })}
          >
            {t('cases.open')}
          </Link>
        </div>
      </article>
    </li>
  );
}

export function CaseListScreen(): JSX.Element {
  const { t } = useLocale();
  const session = useSignedInSession();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page') ?? CASE_LIST_DEFAULTS.page) || 1);
  const [result, setResult] = useState<ListResult | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const requestKey = `${page}:${reloadToken}`;
  const state: ListResult | { kind: 'loading' } =
    result !== null && result.key === requestKey ? result : { kind: 'loading' };
  const created = (location.state as { createdRegistryId?: string } | null)?.createdRegistryId;

  useEffect(() => {
    let cancelled = false;
    api
      .listCases({ page, pageSize: CASE_LIST_DEFAULTS.pageSize })
      .then((response) => {
        if (!cancelled) setResult({ key: requestKey, kind: 'loaded', response });
      })
      .catch((err: unknown) => {
        if (!cancelled) setResult({ key: requestKey, kind: 'failed', error: err });
      });
    return () => {
      cancelled = true;
    };
  }, [page, requestKey]);

  const scope = scopeLineFor(session.principal);
  const newCaseLink = canCreateCase(session) ? (
    <Link to={ROUTES.newCase} className={'btn btn-primary'}>
      {t('shell.nav.new_case')}
    </Link>
  ) : null;

  return (
    <div>
      <div className={'page-head'}>
        <div>
          <h1>{t('cases.title')}</h1>
          <p className={'lede'} data-testid={'scope-line'}>
            {t(scope.key, scope.params)}
          </p>
        </div>
        {newCaseLink}
      </div>
      {created !== undefined ? (
        <p className={'notice notice-success'} role={'status'} style={{ marginTop: 16 }}>
          {t('cases.created_notice', { registryId: created })}
        </p>
      ) : null}
      {state.kind === 'loading' ? (
        <p role={'status'} className={'muted'} style={{ marginTop: 16 }}>
          {t('common.loading')}
        </p>
      ) : null}
      {state.kind === 'failed' ? (
        <div style={{ marginTop: 16 }}>
          <ErrorNotice error={state.error} />
          <button
            type={'button'}
            className={'btn btn-secondary'}
            onClick={() => setReloadToken((n) => n + 1)}
          >
            {t('common.retry')}
          </button>
        </div>
      ) : null}
      {state.kind === 'loaded' ? (
        <>
          <p className={'small muted'} style={{ margin: '14px 0 0' }} data-testid={'case-count'}>
            {t('cases.count', { total: state.response.total })}
          </p>
          {state.response.items.length === 0 ? (
            <div className={'empty-state'}>
              <h2>{t('cases.empty_title')}</h2>
              <p className={'muted'}>{t('cases.empty_body')}</p>
              {newCaseLink}
            </div>
          ) : (
            <ul className={'case-grid'} aria-label={t('cases.list_label')}>
              {state.response.items.map((item) => (
                <CaseCard key={item.caseId} row={toRowModel(item)} />
              ))}
            </ul>
          )}
          {state.response.total > state.response.pageSize ? (
            <nav className={'pagination'} aria-label={t('cases.pagination_label')}>
              <button
                type={'button'}
                className={'btn btn-secondary'}
                disabled={page <= 1}
                onClick={() => setParams({ page: String(page - 1) })}
              >
                {t('cases.prev_page')}
              </button>
              <span className={'small muted'}>
                {t('cases.page_of', {
                  page,
                  pages: pageCount(state.response.total, state.response.pageSize),
                })}
              </span>
              <button
                type={'button'}
                className={'btn btn-secondary'}
                disabled={page >= pageCount(state.response.total, state.response.pageSize)}
                onClick={() => setParams({ page: String(page + 1) })}
              >
                {t('cases.next_page')}
              </button>
            </nav>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
