// W6-05 (W6 plan sections 2.3, 4.2 and 9, Q16): one configuration kind. The revision in force and its body, the
// draft waiting (editing it is W6-06), and the history newest first with each revision's change note, publisher,
// what it restored and how many submitted versions froze it (`frozenOnVersionCount`, as served). From here the Admin
// compares two revisions and restores an earlier one with a change note. Access is the server's: a non-Admin sees
// its 403 notice, and a segment that is not a kind its 404.

import { useCallback, useEffect, useId, useState, type FormEvent, type JSX } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  CONFIGURATION_REVISION_LIST_DEFAULTS,
  CONFIGURATION_VALUES_OWNER,
  type ConfigurationDraftDetail,
  type ConfigurationRevisionDetail,
  type ConfigurationRevisionSummary,
} from '@rai/shared/schemas/configuration-admin';
import { CONFIGURATION_BODY_SCHEMAS } from '@rai/shared/schemas/cases';
import { api } from '../../api/client.js';
import { formatDateTime } from '../../i18n/format.js';
import { useLocale } from '../../i18n/locale-provider.js';
import { ROUTES } from '../../routes.js';
import { AdminLoadError } from './configuration-index.js';
import { isConfigurationKind, kindLabelKey, ownerLabelKey } from './configuration.view-model.js';
import { RestoreDialog, type RestoreTarget } from './restore-dialog.js';
import './admin.css';

interface KindData {
  items: ConfigurationRevisionSummary[];
  total: number;
  page: number;
  current: ConfigurationRevisionDetail | null;
  draft: ConfigurationDraftDetail | null;
}

type Result = { kind: 'loaded'; data: KindData } | { kind: 'failed'; error: unknown };

const PAGE_SIZE = CONFIGURATION_REVISION_LIST_DEFAULTS.pageSize;

function pageOf(value: string | null): number {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

async function loadKind(kind: string, page: number): Promise<KindData> {
  const [list, draft] = await Promise.all([
    api.listConfigurationRevisions(kind, { page, pageSize: PAGE_SIZE }),
    api.getConfigurationDraft(kind),
  ]);
  // The revision in force is the newest (after_publish, Q2): the first row of page 1.
  const newest =
    page === 1
      ? list.items[0]
      : (await api.listConfigurationRevisions(kind, { page: 1, pageSize: 1 })).items[0];
  const current = newest === undefined ? null : await api.getConfigurationRevision(kind, newest.revisionId);
  return { items: list.items, total: list.total, page, current, draft: draft.draft };
}

/** Whether Admin may restore into this kind: a registered body schema (deny by default, as the index `editable`). */
export function restorableKind(kind: string): boolean {
  return Object.hasOwn(CONFIGURATION_BODY_SCHEMAS, kind);
}

/** "Published <when> by <who>" for a revision. */
export function PublishedLine({ revision }: { revision: ConfigurationRevisionSummary }): JSX.Element {
  const { t, locale } = useLocale();
  return (
    <>
      {t('admin.config.published', {
        publishedAt: formatDateTime(locale, revision.publishedAt),
        publishedBy: revision.publishedByDisplayName ?? revision.publishedBy,
      })}
    </>
  );
}

/** A revision body as indented JSON in a keyboard-scrollable block. */
export function RevisionBody({ revision }: { revision: ConfigurationRevisionDetail }): JSX.Element {
  const { t } = useLocale();
  return (
    <div
      className={'admin-body'}
      role={'region'}
      tabIndex={0}
      aria-label={t('admin.config.body_label', { number: revision.revisionNumber })}
    >
      <pre>{JSON.stringify(revision.body, null, 2)}</pre>
    </div>
  );
}

function CompareForm({ kind, items }: { kind: string; items: ConfigurationRevisionSummary[] }): JSX.Element {
  const { t } = useLocale();
  const navigate = useNavigate();
  const fromId = useId();
  const toId = useId();
  const errorId = useId();
  const [from, setFrom] = useState(items[1]?.revisionId ?? items[0]?.revisionId ?? '');
  const [to, setTo] = useState(items[0]?.revisionId ?? '');
  const [same, setSame] = useState(false);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (from === to || from === '' || to === '') {
      setSame(true);
      return;
    }
    const params = new URLSearchParams({ against: from });
    void navigate(`${ROUTES.adminConfigurationRevision(kind, to)}?${params.toString()}`);
  };
  const option = (item: ConfigurationRevisionSummary): JSX.Element => (
    <option key={item.revisionId} value={item.revisionId}>
      {t('admin.config.revision_number', { number: item.revisionNumber })}
    </option>
  );
  return (
    <form className={'admin-compare'} onSubmit={submit} noValidate={true}>
      <div className={'field'}>
        <label htmlFor={fromId}>{t('admin.config.compare.from')}</label>
        <select
          id={fromId}
          value={from}
          aria-invalid={same}
          aria-describedby={same ? errorId : undefined}
          onChange={(event) => {
            setFrom(event.target.value);
            setSame(false);
          }}
        >
          {items.map(option)}
        </select>
      </div>
      <div className={'field'}>
        <label htmlFor={toId}>{t('admin.config.compare.to')}</label>
        <select
          id={toId}
          value={to}
          aria-invalid={same}
          aria-describedby={same ? errorId : undefined}
          onChange={(event) => {
            setTo(event.target.value);
            setSame(false);
          }}
        >
          {items.map(option)}
        </select>
      </div>
      <div className={'admin-compare-actions'}>
        <button type={'submit'} className={'btn btn-secondary'}>
          {t('admin.config.compare.submit')}
        </button>
      </div>
      {same ? (
        <p className={'field-error admin-compare-error'} id={errorId} role={'alert'}>
          {t('admin.config.compare.same')}
        </p>
      ) : null}
    </form>
  );
}

function DraftSection({
  draft,
  current,
}: {
  draft: ConfigurationDraftDetail | null;
  current: ConfigurationRevisionDetail | null;
}): JSX.Element {
  const { t, locale } = useLocale();
  return (
    <section className={'card admin-section'} aria-labelledby={'admin-config-draft-title'}>
      <h2 id={'admin-config-draft-title'}>{t('admin.config.draft.title')}</h2>
      {draft === null ? (
        <p className={'muted'}>{t('admin.config.draft.none')}</p>
      ) : (
        <ul className={'admin-facts'} data-testid={'admin-config-draft'}>
          <li>
            {t('admin.config.draft.saved_by', {
              updatedAt: formatDateTime(locale, draft.updatedAt),
              updatedBy: draft.updatedByDisplayName ?? draft.updatedBy,
            })}
          </li>
          <li>
            {draft.baseRevisionId === null
              ? t('admin.config.draft.based_on_none')
              : current !== null && draft.baseRevisionId === current.revisionId
                ? t('admin.config.draft.based_on', { number: current.revisionNumber })
                : t('admin.config.draft.based_on_stale')}
          </li>
          {draft.changeNote === null ? null : <li>{draft.changeNote}</li>}
          <li>{t('admin.config.draft.problems', { count: draft.problemCount })}</li>
        </ul>
      )}
      <p className={'small muted'}>{t('admin.config.draft.editing_later')}</p>
    </section>
  );
}

export function ConfigurationKindScreen(): JSX.Element {
  const { t, locale } = useLocale();
  const { kind = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const page = pageOf(params.get('page'));
  const [generation, setGeneration] = useState(0);
  const [result, setResult] = useState<Result>();
  const [target, setTarget] = useState<RestoreTarget>();
  const [restored, setRestored] = useState<{ from: number; to: number }>();

  useEffect(() => {
    // A reload keeps the table on screen (focus stays on the control that asked for it) until new data arrives.
    let obsolete = false;
    void loadKind(kind, page).then(
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
  }, [kind, page, generation]);

  const closeDialog = useCallback(() => setTarget(undefined), []);
  const reload = useCallback(() => {
    setTarget(undefined);
    setGeneration((value) => value + 1);
  }, []);

  const labelKey = kindLabelKey(kind);
  const title = labelKey === undefined ? t('admin.config.title') : t(labelKey);
  const canRestore = restorableKind(kind);

  return (
    <div className={'admin-config'}>
      <p className={'small'}>
        <Link to={ROUTES.adminConfiguration}>{t('admin.config.back_to_index')}</Link>
      </p>
      <h1>{title}</h1>
      {result === undefined ? (
        <p role={'status'}>{t('common.loading')}</p>
      ) : result.kind === 'failed' ? (
        <AdminLoadError error={result.error} />
      ) : (
        <>
          {isConfigurationKind(kind) ? (
            <p>
              <span className={`admin-owner admin-owner-${CONFIGURATION_VALUES_OWNER[kind]}`}>
                {t(ownerLabelKey(CONFIGURATION_VALUES_OWNER[kind]))}
              </span>
            </p>
          ) : null}
          <p className={'lede'}>{t('admin.config.applies_note')}</p>
          <div role={'status'} className={'admin-status'}>
            {restored === undefined ? null : (
              <p className={'notice notice-success'} data-testid={'admin-config-restored'}>
                {t('admin.config.restored', restored)}
              </p>
            )}
          </div>

          <section
            className={'card admin-section'}
            aria-labelledby={'admin-config-current-title'}
            data-testid={'admin-config-current'}
          >
            <h2 id={'admin-config-current-title'}>{t('admin.config.current.title')}</h2>
            {result.data.current === null ? (
              <p className={'muted'}>{t('admin.config.current.none')}</p>
            ) : (
              <>
                <ul className={'admin-facts'}>
                  <li className={'admin-strong'}>
                    <Link to={ROUTES.adminConfigurationRevision(kind, result.data.current.revisionId)}>
                      {t('admin.config.revision_number', {
                        number: result.data.current.revisionNumber,
                      })}
                    </Link>
                  </li>
                  <li>
                    <PublishedLine revision={result.data.current} />
                  </li>
                  <li>{result.data.current.changeNote ?? t('admin.config.no_note')}</li>
                  {result.data.current.restoresRevisionNumber === null ? null : (
                    <li>
                      {t('admin.config.restores', {
                        number: result.data.current.restoresRevisionNumber,
                      })}
                    </li>
                  )}
                  <li>
                    {t('admin.config.versions_frozen', {
                      count: result.data.current.frozenOnVersionCount,
                    })}
                  </li>
                </ul>
                <RevisionBody revision={result.data.current} />
              </>
            )}
          </section>

          <DraftSection draft={result.data.draft} current={result.data.current} />

          <section className={'card admin-section'} aria-labelledby={'admin-config-history-title'}>
            <h2 id={'admin-config-history-title'}>{t('admin.config.history.title')}</h2>
            {result.data.total === 0 ? (
              <p className={'muted'}>{t('admin.config.history.empty')}</p>
            ) : (
              <>
                <div
                  className={'admin-table'}
                  role={'region'}
                  aria-labelledby={'admin-config-history-caption'}
                  tabIndex={0}
                >
                  <table data-testid={'admin-config-history'}>
                    <caption id={'admin-config-history-caption'}>{t('admin.config.history.caption')}</caption>
                    <thead>
                      <tr>
                        <th scope={'col'}>{t('admin.config.history.column.revision')}</th>
                        <th scope={'col'}>{t('admin.config.history.column.published')}</th>
                        <th scope={'col'}>{t('admin.config.history.column.by')}</th>
                        <th scope={'col'}>{t('admin.config.history.column.note')}</th>
                        <th scope={'col'}>{t('admin.config.history.column.restores')}</th>
                        <th scope={'col'}>{t('admin.config.history.column.versions')}</th>
                        <th scope={'col'}>{t('admin.config.history.column.in_force')}</th>
                        <th scope={'col'}>{t('admin.config.history.column.actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.data.items.map((item) => (
                        <tr key={item.revisionId} data-revision={item.revisionNumber}>
                          <th scope={'row'}>
                            <Link to={ROUTES.adminConfigurationRevision(kind, item.revisionId)}>
                              {t('admin.config.revision_number', { number: item.revisionNumber })}
                            </Link>
                          </th>
                          <td className={'admin-nowrap'}>{formatDateTime(locale, item.publishedAt)}</td>
                          <td>{item.publishedByDisplayName ?? item.publishedBy}</td>
                          <td data-col={'note'} className={'admin-note'}>
                            {item.changeNote ?? t('admin.config.no_note')}
                          </td>
                          <td data-col={'restores'}>
                            {item.restoresRevisionNumber === null
                              ? null
                              : t('admin.config.revision_number', { number: item.restoresRevisionNumber })}
                          </td>
                          <td data-col={'versions'} className={'admin-num'}>
                            {item.frozenOnVersionCount.toString()}
                          </td>
                          <td data-col={'in_force'}>
                            {item.inForce ? (
                              <span className={'admin-in-force'}>{t('admin.config.history.in_force')}</span>
                            ) : (
                              t('admin.config.history.not_in_force')
                            )}
                          </td>
                          <td>
                            {canRestore && !item.inForce && result.data.current !== null ? (
                              <button
                                type={'button'}
                                className={'btn btn-secondary btn-small'}
                                aria-label={t('admin.config.restore_label', { number: item.revisionNumber })}
                                onClick={() => {
                                  setRestored(undefined);
                                  setTarget({
                                    kind,
                                    revision: item,
                                    expectedCurrentRevisionId: result.data.current!.revisionId,
                                  });
                                }}
                              >
                                {t('admin.config.restore')}
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {result.data.total > PAGE_SIZE ? (
                  <nav className={'pagination'} aria-label={t('admin.config.history.pagination_label')}>
                    <button
                      type={'button'}
                      className={'btn btn-secondary'}
                      disabled={page <= 1}
                      onClick={() => setParams({ page: String(page - 1) })}
                    >
                      {t('cases.prev_page')}
                    </button>
                    <span className={'small muted'}>
                      {t('cases.page_of', { page, pages: Math.ceil(result.data.total / PAGE_SIZE) })}
                    </span>
                    <button
                      type={'button'}
                      className={'btn btn-secondary'}
                      disabled={page * PAGE_SIZE >= result.data.total}
                      onClick={() => setParams({ page: String(page + 1) })}
                    >
                      {t('cases.next_page')}
                    </button>
                  </nav>
                ) : null}
                {result.data.items.length > 1 ? (
                  <section className={'admin-subsection'} aria-labelledby={'admin-config-compare-title'}>
                    <h3 id={'admin-config-compare-title'}>{t('admin.config.compare.title')}</h3>
                    <CompareForm
                      key={result.data.items.map((item) => item.revisionId).join(',')}
                      kind={kind}
                      items={result.data.items}
                    />
                  </section>
                ) : null}
              </>
            )}
          </section>
          <RestoreDialog
            target={target}
            onClose={closeDialog}
            onReload={reload}
            onRestored={(summary, from) => {
              setTarget(undefined);
              setRestored({ from, to: summary.revisionNumber });
              setGeneration((value) => value + 1);
            }}
          />
        </>
      )}
    </div>
  );
}
