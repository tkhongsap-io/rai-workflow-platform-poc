// W1-07 (Lane B): the status badge of W0-02 section 9 item 2. It renders text plus an icon plus colour and cannot
// render without a label: the label is the locale key of the status (D12) and the element carries `data-status`
// so the browser suite's `expectStatusElementsHaveText` can find it. W1-06 and later screens reuse it.

import type { JSX } from 'react';
import type { CaseStatus } from '@rai/shared/schemas/cases';
import type { LocaleKey } from '@rai/shared/locales/keys';
import { useLocale } from '../i18n/locale-provider.js';

export const STATUS_LABEL_KEY: Readonly<Record<CaseStatus, LocaleKey>> = Object.freeze({
  draft: 'status.draft',
  in_review: 'status.in_review',
  sent_back: 'status.sent_back',
  awaiting_disposition: 'status.awaiting_disposition',
  ready_for_launch: 'status.ready_for_launch',
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
    <span className={'status-badge'} data-status={status}>
      <span className={'status-icon'} aria-hidden={true}>
        {STATUS_GLYPH[status]}
      </span>
      <span>{t(STATUS_LABEL_KEY[status])}</span>
    </span>
  );
}
