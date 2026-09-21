// Version navigation (W0-02 7.6; W1-06): the open draft, when one exists, and every submitted version the API
// lists (ascending), each a deep link the SPA resolves (`/cases/{caseId}` for the draft or latest;
// `/cases/{caseId}/versions/{versionId}` for a frozen version). Status is text plus colour; the latest
// submitted version is marked.

import type { JSX } from 'react';
import { NavLink } from 'react-router-dom';
import type { DraftSummary } from '@rai/shared/schemas/pack';
import type { VersionSummary } from '@rai/shared/schemas/versions';
import { Badge, StatusBadge } from '../../components/status-badge.js';
import { formatDateTime } from '../../i18n/format.js';
import { useLocale } from '../../i18n/locale-provider.js';
import { ROUTES } from '../../routes.js';

export interface VersionNavProps {
  caseId: string;
  draft: DraftSummary | null;
  versions: readonly VersionSummary[];
}

export function VersionNav({ caseId, draft, versions }: VersionNavProps): JSX.Element {
  const { t, locale } = useLocale();
  const className = ({ isActive }: { isActive: boolean }): string =>
    isActive ? 'version-link version-link-active' : 'version-link';
  return (
    <nav className={'card versions-nav'} aria-label={t('version.nav_heading')}>
      <h2>{t('version.nav_heading')}</h2>
      <ol className={'versions-list'}>
        {draft !== null ? (
          <li>
            <NavLink to={ROUTES.case(caseId)} end={true} className={className}>
              <span className={'version-name'}>
                {t('version.nav_draft', { number: draft.versionNumber })}
              </span>
              <StatusBadge status={'draft'} />
              <span className={'muted small version-meta'}>
                {t('case.field.updated_at')}
                {': '}
                <time dateTime={draft.updatedAt}>{formatDateTime(locale, draft.updatedAt)}</time>
              </span>
            </NavLink>
          </li>
        ) : null}
        {versions.map((version) => (
          <li key={version.versionId}>
            <NavLink to={ROUTES.caseVersion(caseId, version.versionId)} end={true} className={className}>
              <span className={'version-name'}>
                {t('version.nav_submitted', { number: version.versionNumber })}
              </span>
              {version.isLatest ? (
                <Badge status={'latest'} tone={'info'} label={t('version.latest')} />
              ) : null}
              <span className={'muted small version-meta'}>
                {t('version.submitted_by', { subject: version.submittedBy })}
                {' · '}
                <time dateTime={version.submittedAt}>{formatDateTime(locale, version.submittedAt)}</time>
              </span>
            </NavLink>
          </li>
        ))}
        {versions.length === 0 ? <li className={'muted versions-none'}>{t('version.nav_none')}</li> : null}
      </ol>
    </nav>
  );
}
