// The nine slot rows shared by the draft editor and the frozen version view (design handoff: documents are rows,
// not nested cards; status is text plus colour). A row shows the slot number and name, the lanes that gate it
// under the D02 mapping, the state badge and the document (download link) or the reason.

import type { JSX, ReactNode } from 'react';
import type { LaneMapping } from '@rai/shared/constants';
import type { ArtifactRef } from '@rai/shared/schemas/artifacts';
import type { NotApplicableReason, SlotNumber } from '@rai/shared/schemas/pack';
import { artifactDownloadPath } from '../../api/client.js';
import { useLocale, useT } from './locale.js';
import { StatusBadge, type BadgeTone } from './status-badge.js';
import {
  formatBytes,
  formatDateTime,
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
  const t = useT();
  return <StatusBadge status={state} tone={TONE_BY_STATE[state]} label={t(slotStateKey(state))} />;
}

export function SlotDocument({ row }: { row: SlotRowData }): JSX.Element {
  const t = useT();
  const locale = useLocale();
  if (row.state === 'attached') {
    if (row.artifact === undefined || row.artifact === 'loading')
      return <span className="rai-muted">{t('pack.artifact_loading')}</span>;
    if (row.artifact === 'unavailable')
      return <span className="rai-muted">{t('pack.artifact_unavailable')}</span>;
    const ref = row.artifact;
    return (
      <span className="rai-doc">
        <a
          className="rai-link"
          href={artifactDownloadPath(ref.artifactId)}
          aria-label={t('pack.download', { filename: ref.filename })}
        >
          {ref.filename}
        </a>
        <span className="rai-muted rai-doc__meta">
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
      <span className="rai-reason">
        <span className="rai-muted">{t('slot.reason_default_label')}</span>
        {': '}
        {t(shown.key)}
      </span>
    ) : (
      <span className="rai-reason">{shown.text}</span>
    );
  }
  return <span className="rai-muted">—</span>;
}

export interface SlotRowsProps {
  rows: readonly SlotRowData[];
  mapping: LaneMapping;
  /** Renders the action cell of a row (the editor's Change button); absent in the frozen view. */
  action?: ((row: SlotRowData) => ReactNode) | undefined;
}

export function SlotRows({ rows, mapping, action }: SlotRowsProps): JSX.Element {
  const t = useT();
  return (
    <ol className="rai-slots" aria-label={t('pack.table_label')}>
      {rows.map((row) => {
        const lanes = slotLanes(row.slot, mapping);
        return (
          <li
            key={row.slot}
            className={row.pending ? 'rai-slot rai-slot--pending' : 'rai-slot'}
            data-slot={row.slot}
            aria-labelledby={`slot-${row.slot}-name`}
          >
            <span className="rai-slot__number" aria-hidden="true">
              {row.slot}
            </span>
            <span className="rai-slot__name">
              <span id={`slot-${row.slot}-name`} className="rai-slot__title">
                {t('slot.dialog.title', { number: row.slot, name: t(slotNameKey(row.slot)) })}
              </span>
              <span className="rai-slot__gates rai-muted">
                {lanes.length === 0
                  ? t('pack.gates_none')
                  : t('pack.gates', { lanes: lanes.map((lane) => t(laneKey(lane))).join(', ') })}
              </span>
            </span>
            <span className="rai-slot__state">
              <SlotStateBadge state={row.state} />
            </span>
            <span className="rai-slot__doc">
              <SlotDocument row={row} />
              {row.fieldError !== null && (
                <span className="rai-field__error" role="alert">
                  {row.fieldError}
                </span>
              )}
            </span>
            {action !== undefined && <span className="rai-slot__actions">{action(row)}</span>}
          </li>
        );
      })}
    </ol>
  );
}
