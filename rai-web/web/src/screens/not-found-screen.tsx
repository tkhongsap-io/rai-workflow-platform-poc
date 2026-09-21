// W1-07 (Lane B): the SPA's own not-found page for a path no route matches.

import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { useLocale } from '../i18n/locale-provider.js';
import { ROUTES } from '../routes.js';

export function NotFoundScreen(): JSX.Element {
  const { t } = useLocale();
  return (
    <div>
      <h1>{t('not_found.title')}</h1>
      <p className={'lede'}>{t('not_found.body')}</p>
      <p style={{ marginTop: 16 }}>
        <Link to={ROUTES.cases} className={'btn btn-secondary'}>
          {t('common.back_to_list')}
        </Link>
      </p>
    </div>
  );
}
