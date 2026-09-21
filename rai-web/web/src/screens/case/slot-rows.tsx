// The nine slot rows shared by the draft editor and the frozen version view (design handoff: documents are rows,
// not nested cards; status is text plus colour). A row shows the slot number and name, the lanes that gate it
// under the D02 mapping, the state badge and the document (download link) or the reason.

import type { JSX, ReactNode } from 'react';
import type { LaneMapping } from '@rai/shared/constants';
import type { ArtifactRef } from '@rai/shared/schemas/artifacts';
import type { NotApplicableReason, SlotNumber } from '@rai/shared/schemas/pack';
import { artifactDownloadPath } from '../../api/client.js';
import { Badge, type BadgeTone } from '../../components/status-badge.js';
import { formatBytes, formatDateTime } from '../../i18n/format.js';
import { useLocale } from '../../i18n/locale-provider.js';
import {
  laneKey,
  reasonDisplay,
  slotLanes,
  slotNameKey,
  slotStateKey,
  type SlotStateName,
} from './view-model.js';

const TONE_BY_STATE: Readonly<Record<SlotStateName, BadgeTone>> = {
  attached: 'ok',
  not_yet: 'info',
  missing: 'danger',
  not_applicable: 'muted',
};

export type ArtifactLookup = ArtifactRef | 'loading' | 'unavailable' | undefined;

export interface SlotRowData {
  slot: SlotNumber;
  state: SlotStateName;
  artifact: ArtifactLookup;
  reason: NotApplicableReason | undefined;
  /** True when the row differs from what the server holds (draft editor only). */
  pending: boolean;
  /** A field error from the API that points at this slot, as a key already rendered. */
  fieldError: string | null;
}

export function SlotStateBadge({ state }: { state: SlotStateName }): JSX.Element {
  const { t } = useLocale();
  return <Badge status={state} tone={TONE_BY_STATE[state]} label={t(slotStateKey(state))} />;
}

export function SlotDocument({ row }: { row: SlotRowData }): JSX.Element {
  const { t, locale } = useLocale();
  if (row.state === 'attached') {
    if (row.artifact === undefined || row.artifact === 'loading')
      return <span className={'muted'}>{t('pack.artifact_loading')}</span>;
    if (row.artifact === 'unavailable')
      return <span className={'muted'}>{t('pack.artifact_unavailable')}</span>;
    const ref = row.artifact;
    return (
      <span className={'doc'}>
        <a
          href={artifactDownloadPath(ref.artifactId)}
          aria-label={t('pack.download', { filename: ref.filename })}
        >
          {ref.filename}
        </a>
        <span className={'muted small'}>
          {t('pack.file_meta', {
            size: formatBytes(locale, ref.sizeBytes),
            at: formatDateTime(locale, ref.uploadedAt),
          })}
        </span>
      </span>
    );
  }
  if (row.state === 'not_applicable' && row.reason !== undefined) {
    const shown = reasonDisplay(row.reason);
    return shown.kind === 'key' ? (
      <span>
        <span className={'muted'}>{t('slot.reason_default_label')}</span>
        {': '}
        {t(shown.key)}
      </span>
    ) : (
      <span>{shown.text}</span>
    );
  }
  return <span className={'muted'}>—</span>;
}

export interface SlotRowsProps {
  rows: readonly SlotRowData[];
  mapping: LaneMapping;
  /** Renders the action cell of a row (the editor's Change button); absent in the frozen view. */
  action?: ((row: SlotRowData) => ReactNode) | undefined;
}

export function SlotRows({ rows, mapping, action }: SlotRowsProps): JSX.Element {
  const { t } = useLocale();
  return (
    <ol className={'slots'} aria-label={t('pack.table_label')}>
      {rows.map((row) => {
        const lanes = slotLanes(row.slot, mapping);
        return (
          <li
            key={row.slot}
            className={row.pending ? 'slot-row slot-row-pending' : 'slot-row'}
            data-slot={row.slot}
            aria-labelledby={`slot-${row.slot}-name`}
          >
            <span className={'slot-number'} aria-hidden={true}>
              {row.slot}
            </span>
            <span className={'slot-name'}>
              <span id={`slot-${row.slot}-name`} className={'slot-title'}>
                {t('slot.dialog.title', { number: row.slot, name: t(slotNameKey(row.slot)) })}
              </span>
              <span className={'slot-gates muted small'}>
                {lanes.length === 0
                  ? t('pack.gates_none')
                  : t('pack.gates', { lanes: lanes.map((lane) => t(laneKey(lane))).join(', ') })}
              </span>
            </span>
            <span className={'slot-state'}>
              <SlotStateBadge state={row.state} />
            </span>
            <span className={'slot-doc'}>
              <SlotDocument row={row} />
              {row.fieldError !== null ? (
                <span className={'field-error'} role={'alert'}>
                  {row.fieldError}
                </span>
              ) : null}
            </span>
            {action !== undefined ? <span className={'slot-actions'}>{action(row)}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
