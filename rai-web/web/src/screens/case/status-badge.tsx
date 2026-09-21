// Status badge (W0-02 section 9, item 2): text plus colour and a glyph, never colour alone. The `label` prop is
// required, so a badge without visible text does not compile; `data-status` lets the browser spec assert that
// every status element carries text (tests/browser/support/axe.ts expectStatusElementsHaveText).

import type { JSX } from 'react';

export type BadgeTone = 'neutral' | 'info' | 'ok' | 'warn' | 'danger' | 'muted';

export interface StatusBadgeProps {
  /** The machine value (a case status, slot state or projection); rendered into `data-status`. */
  status: string;
  tone: BadgeTone;
  /** Visible text from t(); required. */
  label: string;
}

export function StatusBadge({ status, tone, label }: StatusBadgeProps): JSX.Element {
  return (
    <span className={`rai-badge rai-badge--${tone}`} data-status={status}>
      {label}
    </span>
  );
}
