// W3-02: presentation of the authoritative queue response. No role-based filtering or count derivation.
import { useEffect, useMemo, useState, type FormEvent, type JSX } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { CaseStatus, LaneProjectionStatus } from '@rai/shared/schemas/cases';
import type { QueueItem, QueueQuery, QueueResponse } from '@rai/shared/schemas/queue';
import { ApiError, api } from '../../api/client.js';
import { ErrorNotice } from '../../components/error-notice.js';
import { Badge, StatusBadge, STATUS_LABEL_KEY, type BadgeTone } from '../../components/status-badge.js';
import { formatDate, formatDateTime } from '../../i18n/format.js';
import { useLocale } from '../../i18n/locale-provider.js';
import { useSession, useSignedInSession } from '../../session/session-provider.js';
import { ROUTES } from '../../routes.js';
import { pageCount } from '../cases/case-list.view-model.js';
import { NEXT_ACTION_LABELS, SEARCH_LABELS, parseQueueQuery, queueParams } from './view-model.js';
import './queue.css';

const LANE_TONE: Record<LaneProjectionStatus, BadgeTone> = {
  pending: 'neutral',
  approved: 'ok',
  sent_back: 'danger',
};

function QueueCard({ item }: { item: QueueItem }): JSX.Element {
  const { t, locale } = useLocale();
  const titleId = `queue-${item.caseId}`;
  return (
    <li>
      <article
        className={'case-card queue-card'}
        aria-labelledby={titleId}
        data-registry-id={item.registryId}
      >
        <div className={'case-card-head'}>
          <div>
            <div className={'eyebrow'}>{item.registryId}</div>
            <h2 id={titleId}>{item.useCaseName}</h2>
          </div>
          <StatusBadge status={item.status} />
        </div>
        <dl className={'case-facts'}>
          <div>
            <dt>{t('case.field.source_record_id')}</dt>
            <dd>
              {item.sourceRecordId.kind === 'known'
                ? item.sourceRecordId.value
                : t('case.field.source_record_unknown')}
            </dd>
          </div>
          <div>
            <dt>{t('cases.owner')}</dt>
            <dd>{item.ownerDisplayName}</dd>
          </div>
          <div>
            <dt>{t('cases.business_unit')}</dt>
            <dd>
              {item.businessUnit} ({item.businessUnitId})
            </dd>
          </div>
          <div>
            <dt>{t('cases.use_case_group')}</dt>
            <dd>{item.useCaseGroup}</dd>
          </div>
          <div>
            <dt>{t('cases.submission')}</dt>
            <dd data-testid={'current-version'}>
              {item.currentVersionNumber === null
                ? t('cases.version_none')
                : t('cases.version_number', { versionNumber: item.currentVersionNumber })}
            </dd>
          </div>
          <div>
            <dt>{t('queue.latest_version')}</dt>
            <dd data-testid={'latest-version'}>
              {t(
                item.currentVersionNumber === null || item.latestVersionNumber > item.currentVersionNumber
                  ? 'version.nav_draft'
                  : 'version.nav_submitted',
                { number: item.latestVersionNumber },
              )}
            </dd>
          </div>
        </dl>
        {item.currentVersionNumber !== null && item.latestVersionNumber > item.currentVersionNumber ? (
          <p className={'small muted'}>
            {t('queue.successor_note', {
              versionNumber: item.currentVersionNumber,
              latestVersionNumber: item.latestVersionNumber,
            })}
          </p>
        ) : null}
        {item.lanes.length === 0 ? (
          <p className={'small muted'}>{t('queue.no_lanes')}</p>
        ) : (
          <section
            className={'queue-review'}
            aria-label={t('queue.review_version', { versionNumber: item.currentVersionNumber! })}
          >
            <h3 className={'eyebrow'}>
              {t('queue.review_version', { versionNumber: item.currentVersionNumber! })}
            </h3>
            <ul className={'queue-lanes'}>
              {item.lanes.map(({ lane, status, due }) => (
                <li key={lane} data-lane={lane}>
                  <span>{t(`lane.${lane}`)}</span>
                  <Badge status={status} tone={LANE_TONE[status]} label={t(`projection.${status}`)} />
                  <time className={'small muted'} dateTime={due.dueOn}>
                    {t('queue.due_on', { date: formatDate(locale, due.dueOn) })}
                  </time>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className={'case-card-foot'}>
          <div>
            <strong className={'small'}>
              {t('cases.next_action', { action: t(NEXT_ACTION_LABELS[item.nextAction]) })}
            </strong>
            <div className={'small muted'}>
              {t('cases.updated_at', { when: formatDateTime(locale, item.updatedAt) })}
            </div>
          </div>
          <Link
            className={'btn btn-secondary'}
            to={ROUTES.case(item.caseId)}
            aria-label={t('cases.open_named', { registryId: item.registryId })}
          >
            {t('cases.open')}
          </Link>
        </div>
      </article>
    </li>
  );
}

function QueueFilters({
  query,
  options,
  apply,
  reset,
}: {
  query: QueueQuery;
  options: QueueResponse['filterOptions'] | undefined;
  apply: (q: QueueQuery) => void;
  reset: () => void;
}): JSX.Element {
  const { t } = useLocale();
  const [search, setSearch] = useState(query.search ?? '');
  const [searchBy, setSearchBy] = useState(query.searchBy ?? 'all');
  const [status, setStatus] = useState(query.status ?? '');
  const [owner, setOwner] = useState(query.owner ?? '');
  const [group, setGroup] = useState(query.useCaseGroup ?? '');
  const [pageSize, setPageSize] = useState(query.pageSize ?? 25);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    apply({
      search,
      searchBy,
      ...(status === '' ? {} : { status: status as CaseStatus }),
      ...(owner === '' ? {} : { owner }),
      ...(group === '' ? {} : { useCaseGroup: group }),
      page: 1,
      pageSize,
    });
  };
  return (
    <form className={'queue-filters'} aria-label={t('queue.filters')} onSubmit={submit}>
      <div className={'field queue-search'}>
        <label htmlFor={'queue-search'}>{t('queue.search')}</label>
        <input
          id={'queue-search'}
          type={'text'}
          maxLength={200}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className={'field'}>
        <label htmlFor={'queue-search-by'}>{t('queue.search_by')}</label>
        <select
          id={'queue-search-by'}
          value={searchBy}
          onChange={(e) => setSearchBy(e.target.value as typeof searchBy)}
        >
          {Object.entries(SEARCH_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {t(label)}
            </option>
          ))}
        </select>
      </div>
      <div className={'field'}>
        <label htmlFor={'queue-status'}>{t('queue.status')}</label>
        <select id={'queue-status'} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value={''}>{t('queue.any')}</option>
          {status !== '' && !options?.statuses.includes(status as CaseStatus) ? (
            <option value={status}>{t(STATUS_LABEL_KEY[status as CaseStatus])}</option>
          ) : null}
          {options?.statuses.map((value) => (
            <option key={value} value={value}>
              {t(STATUS_LABEL_KEY[value])}
            </option>
          ))}
        </select>
      </div>
      <div className={'field'}>
        <label htmlFor={'queue-owner'}>{t('cases.owner')}</label>
        <select id={'queue-owner'} value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value={''}>{t('queue.any')}</option>
          {owner !== '' && !options?.owners.includes(owner) ? <option value={owner}>{owner}</option> : null}
          {options?.owners.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      <div className={'field'}>
        <label htmlFor={'queue-group'}>{t('cases.use_case_group')}</label>
        <select id={'queue-group'} value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value={''}>{t('queue.any')}</option>
          {group !== '' && !options?.useCaseGroups.includes(group) ? (
            <option value={group}>{group}</option>
          ) : null}
          {options?.useCaseGroups.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      <div className={'field'}>
        <label htmlFor={'queue-page-size'}>{t('queue.page_size')}</label>
        <select id={'queue-page-size'} value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
          {[...new Set([10, 25, 50, 100, pageSize])]
            .sort((a, b) => a - b)
            .map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
        </select>
      </div>
      <div className={'queue-filter-actions'}>
        <button className={'btn btn-primary'} type={'submit'}>
          {t('queue.apply')}
        </button>
        <button className={'btn btn-secondary'} type={'button'} onClick={reset}>
          {t('queue.reset')}
        </button>
      </div>
    </form>
  );
}

type Result =
  { key: string; kind: 'loaded'; response: QueueResponse } | { key: string; kind: 'failed'; error: unknown };
export function QueueScreen(): JSX.Element {
  const { t } = useLocale();
  const session = useSignedInSession();
  const { signedOut } = useSession();
  const [params, setParams] = useSearchParams();
  const search = params.toString();
  const parsed = useMemo(() => parseQueueQuery(search), [search]);
  const [reload, setReload] = useState(0);
  const [resetCount, setResetCount] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const actorKey = `${session.principal.subjectId}:${JSON.stringify(session.principal.roles)}`;
  const requestKey = `${actorKey}:${search}:${reload}`;
  const state = result?.key === requestKey ? result : undefined;
  useEffect(() => {
    if (!parsed.valid) return;
    let cancelled = false;
    void api
      .getQueue(parsed.query)
      .then((response) => {
        if (!cancelled) setResult({ key: requestKey, kind: 'loaded', response });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) signedOut('revoked');
        else setResult({ key: requestKey, kind: 'failed', error });
      });
    return () => {
      cancelled = true;
    };
  }, [parsed, requestKey, signedOut]);
  const reset = () => {
    setParams({});
    setResetCount((count) => count + 1);
  };
  const response = state?.kind === 'loaded' ? state.response : undefined;
  const goPage = (page: number) => {
    if (parsed.valid) setParams(queueParams({ ...parsed.query, page }));
  };
  return (
    <div className={'queue-screen'}>
      <div className={'page-head'}>
        <div>
          <h1>{t('queue.title')}</h1>
          <p className={'lede'}>{t('queue.description')}</p>
        </div>
        <Link className={'btn btn-primary'} to={ROUTES.newCase}>
          {t('shell.nav.new_case')}
        </Link>
      </div>
      {!parsed.valid ? (
        <div className={'queue-message'}>
          <p role={'alert'} className={'notice notice-error'}>
            {t('queue.invalid_query')}
          </p>
          <button type={'button'} className={'btn btn-secondary'} onClick={reset}>
            {t('queue.reset')}
          </button>
        </div>
      ) : (
        <>
          <QueueFilters
            key={`${actorKey}:${search}:${resetCount}`}
            query={parsed.query}
            options={response?.filterOptions}
            apply={(q) => setParams(queueParams(q))}
            reset={reset}
          />
          {state === undefined ? (
            <p role={'status'} className={'muted queue-message'}>
              {t('common.loading')}
            </p>
          ) : null}
          {state?.kind === 'failed' ? (
            <div className={'queue-message'}>
              <ErrorNotice error={state.error} />
              <button type={'button'} className={'btn btn-secondary'} onClick={() => setReload((n) => n + 1)}>
                {t('common.retry')}
              </button>
            </div>
          ) : null}
          {response !== undefined ? (
            <>
              <ul className={'queue-summary'} aria-label={t('queue.summary')}>
                {Object.entries(response.statusCounts).map(([status, count]) => (
                  <li key={status}>
                    {t('queue.status_count', { status: t(STATUS_LABEL_KEY[status as CaseStatus]), count })}
                  </li>
                ))}
              </ul>
              <p role={'status'} className={'small muted'} data-testid={'queue-count'}>
                {t('cases.count', { total: response.total })}
              </p>
              {response.items.length === 0 ? (
                <div className={'empty-state'}>
                  <h2>{t(response.total > 0 ? 'queue.empty_page' : 'queue.no_matches')}</h2>
                  <p className={'muted'}>{t('queue.no_matches_body')}</p>
                  <button
                    type={'button'}
                    className={'btn btn-secondary'}
                    onClick={response.total > 0 ? () => goPage(1) : reset}
                  >
                    {t(response.total > 0 ? 'queue.first_page' : 'queue.reset')}
                  </button>
                </div>
              ) : (
                <ul className={'case-grid'} aria-label={t('cases.list_label')}>
                  {response.items.map((item) => (
                    <QueueCard key={item.caseId} item={item} />
                  ))}
                </ul>
              )}
              {response.total > response.pageSize || response.page > 1 ? (
                <nav className={'pagination'} aria-label={t('cases.pagination_label')}>
                  <button
                    className={'btn btn-secondary'}
                    type={'button'}
                    disabled={response.page <= 1}
                    onClick={() => goPage(response.page - 1)}
                  >
                    {t('cases.prev_page')}
                  </button>
                  <span className={'small muted'}>
                    {t('cases.page_of', {
                      page: response.page,
                      pages: pageCount(response.total, response.pageSize),
                    })}
                  </span>
                  <button
                    className={'btn btn-secondary'}
                    type={'button'}
                    disabled={response.page >= pageCount(response.total, response.pageSize)}
                    onClick={() => goPage(response.page + 1)}
                  >
                    {t('cases.next_page')}
                  </button>
                </nav>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
