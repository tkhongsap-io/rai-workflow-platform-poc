// A submitted version (W0-02 7.6 SubmittedVersion): read-only, byte-identical on every read. Shows what the
// version froze (template, stage context, configuration revision, lane-mapping version, submitter and time)
// and the nine frozen slots with their embedded artifact references. No action is offered (A07).

import type { JSX } from 'react';
import { CURRENT_LANE_MAPPING, LANE_MAPPINGS_BY_VERSION } from '@rai/shared/constants';
import type { SubmittedVersion, VersionSummary } from '@rai/shared/schemas/versions';
import { formatDateTime } from '../../i18n/format.js';
import { useLocale } from '../../i18n/locale-provider.js';
import { SlotRows, type SlotRowData } from './slot-rows.js';
import { SLOT_NUMBERS, slotCounts, stageKey } from './view-model.js';

export function PackFrozen({
  version,
  versions,
}: {
  version: SubmittedVersion;
  versions: readonly VersionSummary[];
}): JSX.Element {
  const { t, locale } = useLocale();
  const mapping = LANE_MAPPINGS_BY_VERSION[version.laneMappingVersion] ?? CURRENT_LANE_MAPPING;
  const rows: SlotRowData[] = SLOT_NUMBERS.map((slot) => {
    const frozen = version.slots[slot];
    return {
      slot,
      state: frozen.state,
      artifact: frozen.state === 'attached' ? frozen.artifact : undefined,
      reason: frozen.state === 'not_applicable' ? frozen.reason : undefined,
      pending: false,
      fieldError: null,
    };
  });
  const counts = slotCounts(version.slots);
  const parent = versions.find((v) => v.versionId === version.parentVersionId);
  return (
    <section className={'card'} aria-labelledby={'frozen-heading'}>
      <div className={'panel-head'}>
        <div>
          <h2 id={'frozen-heading'}>{t('version.heading', { number: version.versionNumber })}</h2>
          <p className={'muted'}>{t('version.frozen_note')}</p>
        </div>
        <p className={'muted panel-summary'}>{t('pack.summary', { ...counts })}</p>
      </div>
      <dl className={'facts'}>
        <div>
          <dt>{t('version.field.submitted_by')}</dt>
          <dd>{version.submittedByDisplayName ?? version.submittedBy}</dd>
        </div>
        <div>
          <dt>{t('version.field.submitted_at')}</dt>
          <dd>
            <time dateTime={version.submittedAt}>{formatDateTime(locale, version.submittedAt)}</time>
          </dd>
        </div>
        <div>
          <dt>{t('pack.template_version')}</dt>
          <dd>{version.checklistTemplateVersion}</dd>
        </div>
        <div>
          <dt>{t('pack.stage_context')}</dt>
          <dd>{t(stageKey(version.stageContext))}</dd>
        </div>
        <div>
          <dt>{t('version.configuration_revision')}</dt>
          <dd>
            <code>{version.configurationRevisionId}</code>
          </dd>
        </div>
        <div>
          <dt>{t('version.lane_mapping')}</dt>
          <dd>
            <code>{version.laneMappingVersion}</code>
          </dd>
        </div>
        {parent !== undefined ? (
          <div>
            <dt>{t('version.field.parent')}</dt>
            <dd>{t('version.nav_submitted', { number: parent.versionNumber })}</dd>
          </div>
        ) : null}
      </dl>
      <SlotRows rows={rows} mapping={mapping} />
    </section>
  );
}
