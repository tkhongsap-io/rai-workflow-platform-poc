// W6-05 (W6 plan section 9): one revision of a configuration kind, and the structured diff of two revisions by JSON
// path (`admin/diff.ts`). The URL names the revision shown ("to") and, in `?against=`, the revision it is compared
// with ("from"); without one the page compares with the revision in force, or with the previous revision when this
// is the one in force. From here the Admin can restore the revision (not the one in force) with a change note.

import { useCallback, useEffect, useId, useState, type JSX } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type {
  ConfigurationRevisionDetail,
  ConfigurationRevisionSummary,
} from '@rai/shared/schemas/configuration-admin';
import { api } from '../../api/client.js';
import { useLocale } from '../../i18n/locale-provider.js';
import { ROUTES } from '../../routes.js';
import { AdminLoadError } from './configuration-index.js';
import { PublishedLine, RevisionBody, restorableKind } from './configuration-kind.js';
import { kindLabelKey } from './configuration.view-model.js';
import { defaultAgainst, diffBodies, formatDiffValue, type DiffChange } from './diff.js';
import { RestoreDialog, type RestoreTarget } from './restore-dialog.js';
import './admin.css';

/** Enough of the kind's history to offer every revision in the "compare with" list (the API's page maximum). */
const COMPARE_LIST_SIZE = 100;

interface RevisionData {
  revision: ConfigurationRevisionDetail;
  others: ConfigurationRevisionSummary[];
  inForce: ConfigurationRevisionSummary | undefined;
  against: ConfigurationRevisionDetail | undefined;
}

type Result = { kind: 'loaded'; data: RevisionData } | { kind: 'failed'; error: unknown };

const CHANGE_KEY = {
  added: 'admin.config.diff.change.added',
  removed: 'admin.config.diff.change.removed',
  changed: 'admin.config.diff.change.changed',
} as const satisfies Record<DiffChange, string>;

async function loadRevision(kind: string, revisionId: string, against: string | null): Promise<RevisionData> {
  const [revision, list] = await Promise.all([
    api.getConfigurationRevision(kind, revisionId),
    api.listConfigurationRevisions(kind, { page: 1, pageSize: COMPARE_LIST_SIZE }),
  ]);
  const againstId = against ?? defaultAgainst(list.items, revisionId);
  const other =
    againstId === undefined || againstId === revisionId
      ? undefined
      : await api.getConfigurationRevision(kind, againstId);
  return {
    revision,
    others: list.items.filter((item) => item.revisionId !== revisionId),
    inForce: list.items.find((item) => item.inForce),
    against: other,
  };
}

function DiffTable({
  from,
  to,
}: {
  from: ConfigurationRevisionDetail;
  to: ConfigurationRevisionDetail;
}): JSX.Element {
  const { t } = useLocale();
  const entries = diffBodies(from.body, to.body);
  const numbers = { from: from.revisionNumber, to: to.revisionNumber };
  if (entries.length === 0)
    return (
      <p data-testid={'admin-config-diff-none'} className={'muted'}>
        {t('admin.config.diff.none', numbers)}
      </p>
    );
  return (
    <div className={'admin-table'} role={'region'} aria-labelledby={'admin-config-diff-caption'} tabIndex={0}>
      <table data-testid={'admin-config-diff'}>
        <caption id={'admin-config-diff-caption'}>{t('admin.config.diff.caption', numbers)}</caption>
        <thead>
          <tr>
            <th scope={'col'}>{t('admin.config.diff.column.path')}</th>
            <th scope={'col'}>{t('admin.config.diff.column.change')}</th>
            <th scope={'col'}>{t('admin.config.diff.column.before', { number: from.revisionNumber })}</th>
            <th scope={'col'}>{t('admin.config.diff.column.after', { number: to.revisionNumber })}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.path} data-path={entry.path}>
              <th scope={'row'}>
                <code>{entry.path}</code>
              </th>
              <td data-col={'change'}>
                <span className={`admin-change admin-change-${entry.change}`}>
                  {t(CHANGE_KEY[entry.change])}
                </span>
              </td>
              <td data-col={'before'}>
                <code>{formatDiffValue(entry.before)}</code>
              </td>
              <td data-col={'after'}>
                <code>{formatDiffValue(entry.after)}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RevisionDiffScreen(): JSX.Element {
  const { t } = useLocale();
  const { kind = '', revisionId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const against = params.get('against');
  const selectId = useId();
  const [generation, setGeneration] = useState(0);
  const [result, setResult] = useState<Result>();
  const [target, setTarget] = useState<RestoreTarget>();
  const [restored, setRestored] = useState<{ from: number; to: number }>();

  useEffect(() => {
    let obsolete = false;
    void loadRevision(kind, revisionId, against).then(
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
  }, [kind, revisionId, against, generation]);

  const closeDialog = useCallback(() => setTarget(undefined), []);
  const reload = useCallback(() => {
    setTarget(undefined);
    setGeneration((value) => value + 1);
  }, []);

  const labelKey = kindLabelKey(kind);
  const kindName = labelKey === undefined ? kind : t(labelKey);

  return (
    <div className={'admin-config'}>
      <p className={'small admin-crumbs'}>
        <Link to={ROUTES.adminConfiguration}>{t('admin.config.back_to_index')}</Link>
        {' / '}
        <Link to={ROUTES.adminConfigurationKind(kind)}>{kindName}</Link>
      </p>
      {result === undefined ? (
        <>
          <h1>{t('admin.config.title')}</h1>
          <p role={'status'}>{t('common.loading')}</p>
        </>
      ) : result.kind === 'failed' ? (
        <>
          <h1>{t('admin.config.title')}</h1>
          <AdminLoadError error={result.error} />
        </>
      ) : (
        <>
          <h1>
            {t('admin.config.revision.title', {
              kind: kindName,
              number: result.data.revision.revisionNumber,
            })}
          </h1>
          <div role={'status'} className={'admin-status'}>
            {restored === undefined ? null : (
              <p className={'notice notice-success'} data-testid={'admin-config-restored'}>
                {t('admin.config.restored', restored)}
              </p>
            )}
          </div>
          <section className={'card admin-section'} aria-labelledby={'admin-config-revision-title'}>
            <h2 id={'admin-config-revision-title'}>
              {t('admin.config.revision_number', { number: result.data.revision.revisionNumber })}
            </h2>
            <ul className={'admin-facts'}>
              <li>
                {result.data.revision.inForce ? (
                  <span className={'admin-in-force'}>{t('admin.config.history.in_force')}</span>
                ) : (
                  t('admin.config.history.not_in_force')
                )}
              </li>
              <li>
                <PublishedLine revision={result.data.revision} />
              </li>
              <li>{result.data.revision.changeNote ?? t('admin.config.no_note')}</li>
              {result.data.revision.restoresRevisionNumber === null ? null : (
                <li>{t('admin.config.restores', { number: result.data.revision.restoresRevisionNumber })}</li>
              )}
              <li>
                {t('admin.config.versions_frozen', { count: result.data.revision.frozenOnVersionCount })}
              </li>
            </ul>
            {restorableKind(kind) && !result.data.revision.inForce && result.data.inForce !== undefined ? (
              <p>
                <button
                  type={'button'}
                  className={'btn btn-secondary'}
                  aria-label={t('admin.config.restore_label', {
                    number: result.data.revision.revisionNumber,
                  })}
                  onClick={() => {
                    setRestored(undefined);
                    setTarget({
                      kind,
                      revision: result.data.revision,
                      expectedCurrentRevisionId: result.data.inForce!.revisionId,
                    });
                  }}
                >
                  {t('admin.config.restore')}
                </button>
              </p>
            ) : null}
            <RevisionBody revision={result.data.revision} />
          </section>

          <section className={'card admin-section'} aria-labelledby={'admin-config-diff-title'}>
            <h2 id={'admin-config-diff-title'}>{t('admin.config.diff.title')}</h2>
            {result.data.others.length === 0 ? (
              <p className={'muted'}>{t('admin.config.diff.only_revision')}</p>
            ) : (
              <>
                <div className={'field admin-against'}>
                  <label htmlFor={selectId}>{t('admin.config.diff.against')}</label>
                  <select
                    id={selectId}
                    value={result.data.against?.revisionId ?? ''}
                    onChange={(event) => setParams({ against: event.target.value })}
                  >
                    {result.data.others.map((item) => (
                      <option key={item.revisionId} value={item.revisionId}>
                        {t('admin.config.revision_number', { number: item.revisionNumber })}
                      </option>
                    ))}
                  </select>
                </div>
                {result.data.against === undefined ? null : (
                  <DiffTable from={result.data.against} to={result.data.revision} />
                )}
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
