// W1-07 (Lane B): the `/cases/:caseId` route exists so list rows, W0-06 `refreshPath` values and deep links
// resolve inside the SPA (A05) and require a session; the case overview, nine-slot pack editor and version
// navigation that render here arrive with W1-06, which replaces this element in router.tsx.

import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { useLocale } from '../../i18n/locale-provider.js';
import { ROUTES } from '../../routes.js';

export function CasePlaceholderScreen(): JSX.Element {
  const { t } = useLocale();
  return (
    <div>
      <Link to={ROUTES.cases} className={'btn btn-ghost'}>
        {t('common.back_to_list')}
      </Link>
      <h1 style={{ marginTop: 12 }}>{t('case.placeholder_title')}</h1>
      <p className={'lede'}>{t('case.placeholder_body')}</p>
    </div>
  );
}
