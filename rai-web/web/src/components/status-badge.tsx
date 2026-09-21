// W1-07 (Lane B): the status badge of W0-02 section 9 item 2. It renders text plus an icon plus colour and cannot
// render without a label: the label is the locale key of the status (D12) and the element carries `data-status`
// so the browser suite's `expectStatusElementsHaveText` can find it. W1-06 renders slot states, lane projections
// and the "latest" marker through the generic `Badge` underneath it (a tone, a machine value and a label from t()).

import type { JSX } from 'react';
import type { CaseStatus } from '@rai/shared/schemas/cases';
import type { LocaleKey } from '@rai/shared/locales/keys';
import { useLocale } from '../i18n/locale-provider.js';

export type BadgeTone = 'neutral' | 'info' | 'ok' | 'warn' | 'danger' | 'muted';

/** A glyph per tone so two badges never differ by colour alone (section 9 item 2). */
const TONE_GLYPH: Readonly<Record<BadgeTone, string>> = Object.freeze({
  neutral: '○',
  info: '◔',
  ok: '✓',
  warn: '◑',
  danger: '!',
  muted: '–',
});

export interface BadgeProps {
  /** The machine value (a case status, slot state or projection); rendered into `data-status`. */
  status: string;
  tone: BadgeTone;
  /** Visible text from t(); required, so a badge without text does not compile. */
  label: string;
  /** Overrides the tone's glyph (the case statuses keep their own). */
  glyph?: string;
}

export function Badge({ status, tone, label, glyph }: BadgeProps): JSX.Element {
  return (
    <span className={'status-badge'} data-status={status} data-tone={tone}>
      <span className={'status-icon'} aria-hidden={true}>
        {glyph ?? TONE_GLYPH[tone]}
      </span>
      <span>{label}</span>
    </span>
  );
}

export const STATUS_LABEL_KEY: Readonly<Record<CaseStatus, LocaleKey>> = Object.freeze({
  draft: 'status.draft',
  in_review: 'status.in_review',
  sent_back: 'status.sent_back',
  awaiting_disposition: 'status.awaiting_disposition',
  ready_for_launch: 'status.ready_for_launch',
});

const STATUS_TONE: Readonly<Record<CaseStatus, BadgeTone>> = Object.freeze({
  draft: 'neutral',
  in_review: 'info',
  sent_back: 'danger',
  awaiting_disposition: 'warn',
  ready_for_launch: 'ok',
});

/** A glyph per status so two statuses never differ by colour alone (section 9 item 2). */
const STATUS_GLYPH: Readonly<Record<CaseStatus, string>> = Object.freeze({
  draft: '✎',
  in_review: '◔',
  sent_back: '↩',
  awaiting_disposition: '◑',
  ready_for_launch: '✓',
});

export function StatusBadge({ status }: { status: CaseStatus }): JSX.Element {
  const { t } = useLocale();
  return (
    <Badge
      status={status}
      tone={STATUS_TONE[status]}
      label={t(STATUS_LABEL_KEY[status])}
      glyph={STATUS_GLYPH[status]}
    />
  );
}
