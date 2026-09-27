import type { JSX, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LocaleKey } from '@rai/shared/locales/keys';
import type { DeskHealthReport } from '@rai/shared/schemas/observability';
import { useLocale } from '../../i18n/locale-provider.js';
import { formatDate, formatDateTime } from '../../i18n/format.js';
import {
  OPERATOR_VALUE_KEYS,
  OPERATOR_IDENTITY_REASON_KEYS,
  OPERATOR_MAIL_EVENT_KEYS,
  OPERATOR_LANE_KEYS,
  type OperatorValue,
} from '../../i18n/operator-labels.js';
import { ROUTES } from '../../routes.js';
import { Badge } from '../../components/status-badge.js';
import { migrationsDisplay } from './desk-health.view-model.js';

type FieldName = Extract<LocaleKey, `operator.field.${string}`>;
function Field({ name, children }: { name: FieldName; children: ReactNode }): JSX.Element {
  const { t } = useLocale();
  return (
    <div>
      <dt>{t(name)}</dt>
      <dd>{children ?? t('operator.not_recorded')}</dd>
    </div>
  );
}
function Status({ value }: { value: OperatorValue }): JSX.Element {
  const { t } = useLocale();
  return <span data-status={value}>{t(OPERATOR_VALUE_KEYS[value])}</span>;
}
/** W7-03: the migrations value; `ahead` is a warning badge (glyph, not colour alone) with the additive note. */
function Migrations({ value }: { value: DeskHealthReport['readiness']['store']['migrations'] }): JSX.Element {
  const { t } = useLocale();
  const display = migrationsDisplay(value);
  if (display.tone === undefined) return <Status value={value} />;
  return (
    <>
      <Badge status={value} tone={display.tone} label={t(OPERATOR_VALUE_KEYS[value])} />
      {display.noteKey ? <p className={'operator-note'}>{t(display.noteKey)}</p> : null}
    </>
  );
}
function At({ value }: { value: string | undefined }): JSX.Element {
  const { t, locale } = useLocale();
  return (
    <>{value ? <time dateTime={value}>{formatDateTime(locale, value)}</time> : t('operator.not_recorded')}</>
  );
}
function References({
  recordId,
  correlationId,
  caseId,
  versionId,
}: {
  recordId: string;
  correlationId: string;
  caseId?: string;
  versionId?: string;
}): JSX.Element {
  const { t } = useLocale();
  return (
    <div className={'operator-references'}>
      {caseId ? <Link to={ROUTES.case(caseId)}>{t('operator.open_case')}</Link> : null}
      {caseId && versionId ? (
        <Link to={ROUTES.caseVersion(caseId, versionId)}>{t('operator.open_version')}</Link>
      ) : null}
      <label>
        {t('operator.correlation_copy', { recordId })}
        <input readOnly={true} value={correlationId} onFocus={(event) => event.currentTarget.select()} />
      </label>
    </div>
  );
}
function Records({
  headingKey,
  empty,
  children,
}: {
  headingKey: LocaleKey;
  empty: LocaleKey;
  children: ReactNode[];
}): JSX.Element {
  const { t } = useLocale();
  return (
    <section>
      <h2>{t(headingKey)}</h2>
      {children.length ? <ul className={'operator-records'}>{children}</ul> : <p>{t(empty)}</p>}
    </section>
  );
}

export function DeskHealthSections({ report }: { report: DeskHealthReport }): JSX.Element {
  const { t, locale } = useLocale();
  const r = report.readiness;
  const run = report.slaDigest.lastRun;
  return (
    <>
      <dl>
        <Field name={'operator.field.generated_at'}>
          <At value={report.generatedAt} />
        </Field>
      </dl>
      <p className={'muted'}>{t('operator.recent_records')}</p>
      <section>
        <h2>{t('operator.readiness')}</h2>
        <dl className={'operator-grid'}>
          <Field name={'operator.field.status'}>
            <Status value={r.status} />
          </Field>
          <Field name={'operator.field.checked_at'}>
            <At value={r.checkedAt} />
          </Field>
          <Field name={'operator.field.identity'}>
            <Status value={r.identity.status} />
          </Field>
          <Field name={'operator.field.identity_mode'}>
            <Status value={r.identity.mode} />
          </Field>
          <Field name={'operator.field.loopback_bind'}>
            {t(r.identity.loopbackBind ? 'common.yes' : 'common.no')}
          </Field>
          <Field name={'operator.field.reason'}>
            {r.identity.reason ? t(OPERATOR_IDENTITY_REASON_KEYS[r.identity.reason]) : undefined}
          </Field>
          <Field name={'operator.field.database'}>
            <Status value={r.store.db} />
          </Field>
          <Field name={'operator.field.migrations'}>
            <Migrations value={r.store.migrations} />
          </Field>
          <Field name={'operator.field.blob_store'}>
            <Status value={r.store.blob} />
          </Field>
          <Field name={'operator.field.mail_sink'}>
            <Status value={r.mailSink.kind} /> — <Status value={r.mailSink.status} />
          </Field>
          <Field name={'operator.field.qc'}>
            <Status value={r.qc.kind} /> — <Status value={r.qc.status} />
          </Field>
          <Field name={'operator.field.build_commit'}>{r.build.commit}</Field>
          <Field name={'operator.field.schema_version'}>
            {r.build.schemaVersion === 'unknown' ? t('operator.value.unknown') : r.build.schemaVersion}
          </Field>
        </dl>
      </section>
      <Records headingKey={'operator.failed_mail'} empty={'operator.empty_mail'}>
        {report.failedMail.map((mail) => (
          <li key={mail.notificationId}>
            <dl className={'operator-grid'}>
              <Field name={'operator.field.notification_id'}>{mail.notificationId}</Field>
              <Field name={'operator.field.event'}>{t(OPERATOR_MAIL_EVENT_KEYS[mail.eventType])}</Field>
              <Field name={'operator.field.recipient'}>{mail.recipient}</Field>
              <Field name={'operator.field.status'}>
                <Status value={mail.status} />
              </Field>
              <Field name={'operator.field.attempts'}>{mail.attempts}</Field>
              <Field name={'operator.field.last_error'}>
                <Status value={mail.lastErrorCode} />
              </Field>
              {mail.status === 'failed' ? (
                <Field name={'operator.field.failure_category'}>
                  <Status value={mail.failureCategory} />
                </Field>
              ) : (
                <Field name={'operator.field.next_attempt_at'}>
                  {mail.nextAttemptAt ? <At value={mail.nextAttemptAt} /> : t('operator.not_scheduled')}
                </Field>
              )}
              <Field name={'operator.field.lane'}>
                {mail.lane ? t(OPERATOR_LANE_KEYS[mail.lane]) : undefined}
              </Field>
            </dl>
            <References recordId={mail.notificationId} {...mail} />
          </li>
        ))}
      </Records>
      <Records headingKey={'operator.unavailable_qc'} empty={'operator.empty_qc'}>
        {report.unavailableQc.map((qc) => (
          <li key={qc.qcRunId}>
            <dl className={'operator-grid'}>
              <Field name={'operator.field.qc_run_id'}>{qc.qcRunId}</Field>
              <Field name={'operator.field.trigger'}>
                <Status value={qc.trigger} />
              </Field>
              <Field name={'operator.field.reason'}>
                <Status value={qc.reason} />
              </Field>
              <Field name={'operator.field.lane'}>
                {qc.owningLane ? t(OPERATOR_LANE_KEYS[qc.owningLane]) : undefined}
              </Field>
              <Field name={'operator.field.requested_at'}>
                <At value={qc.requestedAt} />
              </Field>
            </dl>
            <References recordId={qc.qcRunId} {...qc} />
          </li>
        ))}
      </Records>
      <p>{t('operator.late_qc_note')}</p>
      <Records headingKey={'operator.late_qc'} empty={'operator.empty_late_qc'}>
        {report.lateQc.map((qc) => (
          <li key={qc.lateResultId}>
            <dl className={'operator-grid'}>
              <Field name={'operator.field.late_result_id'}>{qc.lateResultId}</Field>
              <Field name={'operator.field.qc_run_id'}>{qc.qcRunId}</Field>
              <Field name={'operator.field.trigger'}>
                <Status value={qc.trigger} />
              </Field>
              <Field name={'operator.field.status'}>
                <Status value={qc.status} />
              </Field>
              <Field name={'operator.field.lane'}>
                {qc.lane ? t(OPERATOR_LANE_KEYS[qc.lane]) : undefined}
              </Field>
              <Field name={'operator.field.refused_finding_count'}>{qc.refusedFindingCount}</Field>
              <Field name={'operator.field.recorded_at'}>
                <At value={qc.recordedAt} />
              </Field>
            </dl>
            <References recordId={qc.lateResultId} {...qc} />
          </li>
        ))}
      </Records>
      <section>
        <h2>{t('operator.sla_digest')}</h2>
        <h3>{t('operator.last_run')}</h3>
        {run ? (
          <>
            <dl className={'operator-grid'}>
              <Field name={'operator.field.job_run_id'}>{run.jobRunId}</Field>
              <Field name={'operator.field.digest_day'}>{formatDate(locale, run.digestDay)}</Field>
              <Field name={'operator.field.status'}>
                <Status value={run.status} />
              </Field>
              <Field name={'operator.field.started_at'}>
                <At value={run.startedAt} />
              </Field>
              <Field name={'operator.field.finished_at'}>
                <At value={run.finishedAt} />
              </Field>
              <Field name={'operator.field.breach_count'}>{run.breachCount}</Field>
              <Field name={'operator.field.notification_ids'}>
                {run.notificationIds.length
                  ? run.notificationIds.join(', ')
                  : t('operator.empty_notifications')}
              </Field>
              <Field name={'operator.field.error_code'}>
                {run.errorCode ? <Status value={run.errorCode} /> : undefined}
              </Field>
            </dl>
            <References recordId={run.jobRunId} correlationId={run.correlationId} />
          </>
        ) : (
          <p>{t('operator.no_run')}</p>
        )}
        <Records headingKey={'operator.recent_failures'} empty={'operator.empty_digest_failures'}>
          {report.slaDigest.recentFailures.map((failure) => (
            <li key={failure.jobRunId}>
              <dl className={'operator-grid'}>
                <Field name={'operator.field.job_run_id'}>{failure.jobRunId}</Field>
                <Field name={'operator.field.digest_day'}>{formatDate(locale, failure.digestDay)}</Field>
                <Field name={'operator.field.started_at'}>
                  <At value={failure.startedAt} />
                </Field>
                <Field name={'operator.field.stage'}>
                  <Status value={failure.stage} />
                </Field>
                <Field name={'operator.field.error_code'}>
                  <Status value={failure.errorCode} />
                </Field>
              </dl>
              <References recordId={failure.jobRunId} correlationId={failure.correlationId} />
            </li>
          ))}
        </Records>
      </section>
      <p>{t('operator.counter_note')}</p>
      <Records headingKey={'operator.error_counters'} empty={'operator.empty_counters'}>
        {report.errorCounters.map((counter) => (
          <li key={counter.code}>
            <dl className={'operator-grid'}>
              <Field name={'operator.field.error_code'}>
                <Status value={counter.code} />
              </Field>
              <Field name={'operator.field.count'}>{counter.count}</Field>
              <Field name={'operator.field.last_at'}>
                <At value={counter.lastAt} />
              </Field>
            </dl>
          </li>
        ))}
      </Records>
    </>
  );
}
