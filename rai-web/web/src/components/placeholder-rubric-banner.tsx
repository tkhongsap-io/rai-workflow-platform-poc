// W5 plan section 7 (W5-07): the placeholder rubric banner, shown wherever rubric text or a tier appears while the
// rubric's provenance is 'synthetic_placeholder' (R-2). The W5 schema accepts no other provenance, so today it always
// shows; a D07 instrument would need a schema change first. `role="note"`: information, never an error.

import type { JSX } from 'react';
import type { RiskRubricBody } from '@rai/shared/schemas/cases';
import { useLocale } from '../i18n/locale-provider.js';

export function PlaceholderRubricBanner({
  provenance,
}: {
  provenance: RiskRubricBody['provenance'];
}): JSX.Element | null {
  const { t } = useLocale();
  if (provenance !== 'synthetic_placeholder') return null;
  return (
    <p className={'notice placeholder-rubric-banner'} role={'note'} data-placeholder-rubric={'true'}>
      {t('risk.placeholder.banner')}
    </p>
  );
}
