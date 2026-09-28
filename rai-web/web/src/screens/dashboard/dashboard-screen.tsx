// W6-15 (W6 plan sections 8 and 9): the desk dashboard. It renders `GET /api/dashboard` as served: every count is
// the server's, inside the viewer's scope (W6-13); the screen never counts, filters or hides a number by role. A
// number the queue can list links to its W6-14 drill-down; a 0, and a count the queue cannot list (QC runs, weeks,
// risk tiers before W6-16), is plain text. Each tile is a captioned table; bars are decoration (`aria-hidden`).

import { useEffect, useState, type JSX, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LANES, DASHBOARD_DUE_SOON_WORKING_DAYS, type Lane } from '@rai/shared/constants';
import { CASE_STATUSES, type CaseStatus } from '@rai/shared/schemas/cases';
import { DASHBOARD_ACTIVITY_WEEKS, type DashboardResponse } from '@rai/shared/schemas/dashboard';
import type { QueueQuery } from '@rai/shared/schemas/queue';
import { api, InvalidResponseError } from '../../api/client.js';
import { ErrorNotice } from '../../components/error-notice.js';
import { STATUS_LABEL_KEY } from '../../components/status-badge.js';
import { formatDate, formatDateTime, INTL_LOCALE_BY_LOCALE } from '../../i18n/format.js';
import { useLocale } from '../../i18n/locale-provider.js';
import { useSignedInSession } from '../../session/session-provider.js';
import { ROUTES } from '../../routes.js';
import {
  barPercent,
  countCell,
  defectQuery,
  findingCount,
  isEmptyDashboard,
  laneSlaQuery,
  laneStateQuery,
  statusQuery,
  unavailableQuery,
  unavailableTotal,
  type Severity,
} from './dashboard.view-model.js';
import './dashboard.css';

const SEVERITIES: readonly Severity[] = ['high', 'medium', 'low'];

type Result =
  { key: string; kind: 'loaded'; data: DashboardResponse } | { key: string; kind: 'failed'; error: unknown };

/** A number as text; with a queue filter and a non-zero count, a link whose name says what it opens. */
function Count({
  count,
  query,
  row,
  column,
}: {
  count: number;
  query?: QueueQuery;
  row: string;
  column: string;
}): JSX.Element {
  const { t, locale } = useLocale();
  const cell = countCell(count, query);
  const text = count.toLocaleString(INTL_LOCALE_BY_LOCALE[locale]);
  if (cell.kind === 'text') return <>{text}</>;
  return (
    <Link to={cell.to} aria-label={t('dashboard.link_label', { count: text, row, column })}>
      {text}
    </Link>
  );
}

function Bar({ count, max }: { count: number; max: number }): JSX.Element {
  return (
    <span className={'dashboard-bar'} aria-hidden={true}>
      <span style={{ width: `${barPercent(count, max)}%` }} />
    </span>
  );
}

/** A tile: a heading and one captioned table in a keyboard-reachable region (a narrow screen scrolls it). */
function Tile({
  tile,
  title,
  caption,
  children,
  after,
  wide = false,
}: {
  tile: string;
  title: string;
  caption: string;
  children: ReactNode;
  after?: ReactNode;
  /** Spans two grid columns on a wide screen (a table with many columns). */
  wide?: boolean;
}): JSX.Element {
  const headingId = `dashboard-${tile}-title`;
  return (
    <section
      className={wide ? 'card dashboard-tile dashboard-tile-wide' : 'card dashboard-tile'}
      data-tile={tile}
      aria-labelledby={headingId}
    >
      <h2 id={headingId}>{title}</h2>
      <div className={'dashboard-table'} role={'region'} aria-labelledby={headingId} tabIndex={0}>
        <table>
          <caption>{caption}</caption>
          {children}
        </table>
      </div>
      {after}
    </section>
  );
}

function StatusTile({ data }: { data: DashboardResponse }): JSX.Element {
  const { t } = useLocale();
  const max = Math.max(0, ...CASE_STATUSES.map((status) => data.cases.byStatus[status]));
  const column = t('dashboard.status.column_count');
  return (
    <Tile tile={'status'} title={t('dashboard.status.title')} caption={t('dashboard.status.caption')}>
      <thead>
        <tr>
          <th scope={'col'}>{t('dashboard.status.column_status')}</th>
          <th scope={'col'}>{column}</th>
        </tr>
      </thead>
      <tbody>
        {CASE_STATUSES.map((status: CaseStatus) => {
          const label = t(STATUS_LABEL_KEY[status]);
          const count = data.cases.byStatus[status];
          return (
            <tr key={status} data-row={status}>
              <th scope={'row'}>{label}</th>
              <td className={'dashboard-num'}>
                <span data-col={'count'}>
                  <Count count={count} query={statusQuery(status)} row={label} column={column} />
                </span>
                <Bar count={count} max={max} />
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr data-row={'total'}>
          <th scope={'row'}>{t('dashboard.status.total')}</th>
          <td className={'dashboard-num'}>
            <span data-col={'count'}>
              <Count count={data.cases.total} query={{}} row={t('dashboard.status.total')} column={column} />
            </span>
          </td>
        </tr>
      </tfoot>
    </Tile>
  );
}

function LanesTile({ data }: { data: DashboardResponse }): JSX.Element {
  const { t } = useLocale();
  const columns = [
    {
      key: 'pending',
      label: t('projection.pending'),
      query: (lane: Lane) => laneStateQuery(lane, 'pending'),
    },
    {
      key: 'approved',
      label: t('projection.approved'),
      query: (lane: Lane) => laneStateQuery(lane, 'approved'),
    },
    {
      key: 'sentBack',
      label: t('projection.sent_back'),
      query: (lane: Lane) => laneStateQuery(lane, 'sent_back'),
    },
    {
      key: 'dueSoon',
      label: t('dashboard.lanes.column_due_soon', { days: DASHBOARD_DUE_SOON_WORKING_DAYS }),
      query: (lane: Lane) => laneSlaQuery(lane, 'due_soon'),
    },
    {
      key: 'breached',
      label: t('dashboard.lanes.column_breached'),
      query: (lane: Lane) => laneSlaQuery(lane, 'breached'),
    },
  ] as const;
  return (
    <Tile
      wide={true}
      tile={'lanes'}
      title={t('dashboard.lanes.title')}
      caption={t('dashboard.lanes.caption')}
    >
      <thead>
        <tr>
          <th scope={'col'}>{t('dashboard.lane_column')}</th>
          {columns.map((column) => (
            <th
              key={column.key}
              scope={'col'}
              className={column.key === 'breached' ? 'dashboard-alert' : undefined}
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.lanes.map((row) => {
          const label = t(`lane.${row.lane}`);
          return (
            <tr key={row.lane} data-row={row.lane}>
              <th scope={'row'}>{label}</th>
              {columns.map((column) => (
                <td
                  key={column.key}
                  data-col={column.key}
                  className={
                    column.key === 'breached' && row.breached > 0
                      ? 'dashboard-num dashboard-alert'
                      : 'dashboard-num'
                  }
                >
                  <Count
                    count={row[column.key]}
                    query={column.query(row.lane)}
                    row={label}
                    column={column.label}
                  />
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </Tile>
  );
}

function FindingsTile({ data }: { data: DashboardResponse }): JSX.Element {
  const { t, locale } = useLocale();
  const unavailable = t('dashboard.findings.column_unavailable');
  const paused = t('dashboard.findings.column_paused');
  return (
    <Tile
      wide={true}
      tile={'findings'}
      title={t('dashboard.findings.title')}
      caption={t('dashboard.findings.caption')}
      after={
        <p className={'small muted'} data-testid={'dashboard-advisory'}>
          {t('dashboard.findings.advisory', {
            count: data.findings.advisory.toLocaleString(INTL_LOCALE_BY_LOCALE[locale]),
          })}
        </p>
      }
    >
      <thead>
        <tr>
          <th scope={'col'}>{t('dashboard.lane_column')}</th>
          {SEVERITIES.map((severity) => (
            <th key={severity} scope={'col'}>
              {t('dashboard.findings.column_defect', { severity: t(`finding.severity.${severity}`) })}
            </th>
          ))}
          <th scope={'col'}>{unavailable}</th>
          <th scope={'col'}>{paused}</th>
        </tr>
      </thead>
      <tbody>
        {LANES.map((lane) => {
          const label = t(`lane.${lane}`);
          return (
            <tr key={lane} data-row={lane}>
              <th scope={'row'}>{label}</th>
              {SEVERITIES.map((severity) => {
                const column = t('dashboard.findings.column_defect', {
                  severity: t(`finding.severity.${severity}`),
                });
                return (
                  <td key={severity} data-col={severity} className={'dashboard-num'}>
                    <Count
                      count={findingCount(data, lane, severity)}
                      query={defectQuery(lane, severity)}
                      row={label}
                      column={column}
                    />
                  </td>
                );
              })}
              <td data-col={'unavailable'} className={'dashboard-num'}>
                <Count
                  count={unavailableTotal(data, lane)}
                  query={unavailableQuery(lane)}
                  row={label}
                  column={unavailable}
                />
              </td>
              <td data-col={'paused'} className={'dashboard-num'}>
                <Count count={data.findings.unavailableOpen[lane].paused} row={label} column={paused} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </Tile>
  );
}

function QcTile({ data }: { data: DashboardResponse }): JSX.Element {
  const { t } = useLocale();
  const rows = [
    { key: 'runs30d', label: t('dashboard.qc.runs') },
    { key: 'unavailableRuns30d', label: t('dashboard.qc.unavailable_runs') },
    { key: 'pausedRuns30d', label: t('dashboard.qc.paused_runs') },
    { key: 'rechecks30d', label: t('dashboard.qc.rechecks') },
  ] as const;
  const column = t('dashboard.qc.column_count');
  return (
    <Tile tile={'qc'} title={t('dashboard.qc.title')} caption={t('dashboard.qc.caption')}>
      <thead>
        <tr>
          <th scope={'col'}>{t('dashboard.qc.column_measure')}</th>
          <th scope={'col'}>{column}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} data-row={row.key}>
            <th scope={'row'}>{row.label}</th>
            <td data-col={'count'} className={'dashboard-num'}>
              <Count count={data.qc[row.key]} row={row.label} column={column} />
            </td>
          </tr>
        ))}
      </tbody>
    </Tile>
  );
}

function RiskTile({ data }: { data: DashboardResponse }): JSX.Element {
  const { t } = useLocale();
  const headingId = 'dashboard-risk-title';
  if (!data.risk.available) {
    return (
      <section className={'card dashboard-tile'} data-tile={'risk'} aria-labelledby={headingId}>
        <h2 id={headingId}>{t('dashboard.risk.title')}</h2>
        <p className={'muted'}>{t('dashboard.risk.unavailable')}</p>
      </section>
    );
  }
  const column = t('dashboard.risk.column_count');
  return (
    <Tile tile={'risk'} title={t('dashboard.risk.title')} caption={t('dashboard.risk.caption')}>
      <thead>
        <tr>
          <th scope={'col'}>{t('dashboard.risk.column_tier')}</th>
          <th scope={'col'}>{column}</th>
        </tr>
      </thead>
      <tbody>
        {/* Tier labels are stored rubric labels (D07's, provisional), rendered as stored, never translated. */}
        {data.risk.tiers.map((tier) => (
          <tr key={tier.tier} data-row={tier.tier}>
            <th scope={'row'}>{tier.tier}</th>
            <td data-col={'count'} className={'dashboard-num'}>
              <Count count={tier.count} row={tier.tier} column={column} />
            </td>
          </tr>
        ))}
        <tr data-row={'notAssessed'}>
          <th scope={'row'}>{t('dashboard.risk.not_assessed')}</th>
          <td data-col={'count'} className={'dashboard-num'}>
            <Count count={data.risk.notAssessed} row={t('dashboard.risk.not_assessed')} column={column} />
          </td>
        </tr>
      </tbody>
    </Tile>
  );
}

function ActivityTile({ data }: { data: DashboardResponse }): JSX.Element {
  const { t, locale } = useLocale();
  const columns = [
    { key: 'submitted', label: t('dashboard.activity.column_submitted') },
    { key: 'resubmitted', label: t('dashboard.activity.column_resubmitted') },
    { key: 'sentBack', label: t('dashboard.activity.column_sent_back') },
    { key: 'ready', label: t('dashboard.activity.column_ready') },
  ] as const;
  const max = Math.max(0, ...data.activity.map((week) => week.submitted));
  return (
    <Tile
      wide={true}
      tile={'activity'}
      title={t('dashboard.activity.title', { weeks: DASHBOARD_ACTIVITY_WEEKS })}
      caption={t('dashboard.activity.caption')}
    >
      <thead>
        <tr>
          <th scope={'col'}>{t('dashboard.activity.column_week')}</th>
          {columns.map((column) => (
            <th key={column.key} scope={'col'}>
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.activity.map((week) => {
          const label = formatDate(locale, `${week.weekStart}T00:00:00+07:00`);
          return (
            <tr key={week.weekStart} data-row={week.weekStart}>
              <th scope={'row'}>
                <time dateTime={week.weekStart}>{label}</time>
              </th>
              {columns.map((column) => (
                <td key={column.key} data-col={column.key} className={'dashboard-num'}>
                  <Count count={week[column.key]} row={label} column={column.label} />
                  {column.key === 'submitted' ? <Bar count={week.submitted} max={max} /> : null}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </Tile>
  );
}

export function DashboardScreen(): JSX.Element {
  const { t, locale } = useLocale();
  const session = useSignedInSession();
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const requestKey = `${session.principal.subjectId}:${JSON.stringify(session.principal.roles)}:${reload}`;
  const state = result?.key === requestKey ? result : undefined;

  useEffect(() => {
    let cancelled = false;
    void api.getDashboard().then(
      (data) => {
        if (!cancelled) setResult({ key: requestKey, kind: 'loaded', data });
      },
      (error: unknown) => {
        if (!cancelled) setResult({ key: requestKey, kind: 'failed', error });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [requestKey]);

  const data = state?.kind === 'loaded' ? state.data : undefined;
  return (
    <div className={'dashboard-screen'}>
      <div className={'page-head'}>
        <div>
          <h1>{t('dashboard.title')}</h1>
          <p className={'lede'}>{t('dashboard.description')}</p>
          {data !== undefined ? (
            <p className={'small muted'} data-testid={'dashboard-as-of'}>
              {t('dashboard.as_of', { when: formatDateTime(locale, data.asOf) })}
            </p>
          ) : null}
        </div>
        {state !== undefined ? (
          <button type={'button'} className={'btn btn-secondary'} onClick={() => setReload((n) => n + 1)}>
            {t(state.kind === 'failed' ? 'common.retry' : 'dashboard.refresh')}
          </button>
        ) : null}
      </div>
      {state === undefined ? (
        <p role={'status'} className={'muted'}>
          {t('common.loading')}
        </p>
      ) : null}
      {state?.kind === 'failed' ? (
        state.error instanceof InvalidResponseError ? (
          <p role={'alert'} className={'notice notice-error'}>
            {t('dashboard.invalid_response')}
          </p>
        ) : (
          <ErrorNotice error={state.error} />
        )
      ) : null}
      {data !== undefined && isEmptyDashboard(data) ? (
        <div className={'empty-state'}>
          <h2>{t('dashboard.empty')}</h2>
          <p className={'muted'}>{t('dashboard.empty_body')}</p>
          <Link className={'btn btn-secondary'} to={ROUTES.queue}>
            {t('queue.title')}
          </Link>
        </div>
      ) : null}
      {data !== undefined && !isEmptyDashboard(data) ? (
        <div className={'dashboard-grid'}>
          <StatusTile data={data} />
          <LanesTile data={data} />
          <FindingsTile data={data} />
          <QcTile data={data} />
          <RiskTile data={data} />
          <ActivityTile data={data} />
        </div>
      ) : null}
    </div>
  );
}
