// W4-12 (W4a plan section 7): the QC log of a submitted version — every QC run recorded on it, oldest first, from
// GET …/versions/{versionId}/qc-runs. Each run names its trigger and scope, the runner and its version, the rule
// revision (label when the catalogue has one), the rules it evaluated and the findings it stored. An unavailable run
// and a completed run that evaluated 0 rules each read differently from "no findings": neither is a clean pass (A08).
// Read only; the API decides who may see it.

import { useEffect, useId, useState, type JSX } from 'react';
import type { QcRunSummary } from '@rai/shared/schemas/review';
import { api } from '../../api/client.js';
import { ErrorNotice } from '../../components/error-notice.js';
import { Badge, type BadgeTone } from '../../components/status-badge.js';
import { formatDateTime } from '../../i18n/format.js';
import { useLocale } from '../../i18n/locale-provider.js';
import {
  laneKey,
  qcRunOutcome,
  qcRunOutcomeKey,
  qcTriggerKey,
  qcUnavailableReasonKey,
  type QcRunOutcome,
} from './view-model.js';

const OUTCOME_TONE: Readonly<Record<QcRunOutcome, BadgeTone>> = {
  unavailable: 'warn',
  no_rules: 'warn',
  findings: 'info',
  no_findings: 'ok',
  not_recorded: 'muted',
};

type LoadResult = { kind: 'ready'; runs: QcRunSummary[] } | { kind: 'error'; error: unknown };

/** The trigger with its lane, slot or whole-pack scope, e.g. "Upload · slot 2". */
export function useQcRunScope(): (run: Pick<QcRunSummary, 'trigger' | 'lane' | 'slot'>) => string {
  const { t } = useLocale();
  return (run) => {
    const trigger = t(qcTriggerKey(run.trigger));
    if (run.lane !== null) return t('qc_log.scope.lane', { trigger, lane: t(laneKey(run.lane)) });
    if (run.slot !== null) return t('qc_log.scope.slot', { trigger, number: run.slot });
    return t('qc_log.scope.pack', { trigger });
  };
}

export function QcLog({
  caseId,
  versionId,
  refreshKey,
}: {
  caseId: string;
  versionId: string;
  /** Changes when a run was added on this screen (a lane-QC run), so the log reads again. */
  refreshKey: number;
}): JSX.Element {
  const { t } = useLocale();
  const headingId = useId();
  const [reloadToken, setReloadToken] = useState(0);
  const key = `${caseId}/${versionId}#${refreshKey}#${reloadToken}`;
  const [stored, setStored] = useState<{ key: string; result: LoadResult } | null>(null);
  const state = stored !== null && stored.key === key ? stored.result : null;

  useEffect(() => {
    let cancelled = false;
    void api
      .listQcRuns(caseId, versionId)
      .then((response) => {
        if (!cancelled) setStored({ key, result: { kind: 'ready', runs: response.runs } });
      })
      .catch((err: unknown) => {
        if (!cancelled) setStored({ key, result: { kind: 'error', error: err } });
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, versionId, key]);

  return (
    <section className={'card qc-log'} aria-labelledby={headingId} data-qc-log={state?.kind ?? 'loading'}>
      <h2 id={headingId}>{t('qc_log.heading')}</h2>
      <p className={'muted'}>{t('qc_log.intro')}</p>
      {state === null ? (
        <p className={'muted'}>{t('common.loading')}</p>
      ) : state.kind === 'error' ? (
        <>
          <p className={'muted'}>{t('qc_log.error')}</p>
          <ErrorNotice error={state.error}>
            <button
              type={'button'}
              className={'btn btn-secondary'}
              onClick={() => {
                setReloadToken((n) => n + 1);
              }}
            >
              {t('action.reload')}
            </button>
          </ErrorNotice>
        </>
      ) : state.runs.length === 0 ? (
        <p className={'muted'} data-qc-log-empty={true}>
          {t('qc_log.empty')}
        </p>
      ) : (
        <ul className={'qc-log-list'} aria-label={t('qc_log.list_label')}>
          {state.runs.map((run) => (
            <QcRunRow key={run.runId} run={run} />
          ))}
        </ul>
      )}
    </section>
  );
}

function QcRunRow({ run }: { run: QcRunSummary }): JSX.Element {
  const { t, locale } = useLocale();
  const scopeOf = useQcRunScope();
  const outcome = qcRunOutcome(run);
  const label =
    outcome === 'unavailable'
      ? t(qcRunOutcomeKey(outcome), { reason: t(qcUnavailableReasonKey(run.unavailableReason ?? undefined)) })
      : t(qcRunOutcomeKey(outcome));
  return (
    <li className={'qc-run-row'} data-qc-run-id={run.runId} data-qc-outcome={outcome}>
      <Badge status={`qc-${outcome}`} tone={OUTCOME_TONE[outcome]} label={label} />
      <div className={'qc-run-body'}>
        <p className={'qc-run-scope'}>
          <strong>{scopeOf(run)}</strong>
        </p>
        <p className={'muted small'}>
          {t('qc_log.runner', { runner: run.runner, version: run.runnerVersion })}
          {' · '}
          {run.rulesLabel === null
            ? t('qc_log.revision_unlabelled', { revision: run.ruleRevision })
            : t('qc_log.revision', { label: run.rulesLabel })}
        </p>
        <p className={'muted small'}>
          {run.rulesEvaluated === null
            ? t('qc_log.rules_unrecorded')
            : t('qc_log.rules_evaluated', { count: run.rulesEvaluated })}
          {' · '}
          {t('qc_log.findings', { count: run.findingCount })}
          {' · '}
          <time dateTime={run.requestedAt}>
            {t('qc_log.requested_at', { at: formatDateTime(locale, run.requestedAt) })}
          </time>
        </p>
      </div>
    </li>
  );
}
