// W5-09 (W5 plan section 7, "Queue and case list"): the proposed-tier fact on a queue or case-list card. Rendered only
// when the item has a tier (absent or null shows nothing). Text plus glyph plus tone, never colour alone; the tier is
// a desk proposal from the synthetic placeholder rubric (D07 open), so the list shows the placeholder banner with it.

import type { JSX } from 'react';
import type { RiskTier } from '@rai/shared/schemas/cases';
import { Badge } from '../../components/status-badge.js';
import { useLocale } from '../../i18n/locale-provider.js';
import { riskTierChipOf } from './case-list.view-model.js';

/** One `case-facts` row (`dt`/`dd`) inside the card's `dl`. */
export function RiskTierFact({ riskTier }: { riskTier: RiskTier | null | undefined }): JSX.Element | null {
  const { t } = useLocale();
  const chip = riskTierChipOf(riskTier);
  if (chip === null) return null;
  return (
    <div data-risk-tier={chip.tier}>
      <dt>{t('risk.list.tier')}</dt>
      <dd>
        <Badge status={chip.tier} tone={chip.tone} label={t(chip.labelKey)} />
      </dd>
    </div>
  );
}
