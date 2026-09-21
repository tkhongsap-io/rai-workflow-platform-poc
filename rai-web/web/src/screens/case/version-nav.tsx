// Version navigation (W0-02 7.6; W1-06): the open draft, when one exists, and every submitted version the API
// lists (ascending), each a deep link the SPA resolves (`/cases/{caseId}` for the draft or latest;
// `/cases/{caseId}/versions/{versionId}` for a frozen version). Status is text plus colour; the latest
// submitted version is marked.

import type { JSX } from 'react';
import { NavLink } from 'react-router-dom';
import type { DraftSummary } from '@rai/shared/schemas/pack';
import type { VersionSummary } from '@rai/shared/schemas/versions';
import { useLocale, useT } from './locale.js';
import { StatusBadge } from './status-badge.js';
import { casePath, formatDateTime, versionPath } from './view-model.js';

export interface VersionNavProps {
  caseId: string;
  draft: DraftSummary | null;
  versions: readonly VersionSummary[];
}

export function VersionNav({ caseId, draft, versions }: VersionNavProps): JSX.Element {
  const t = useT();
  const locale = useLocale();
  const className = ({ isActive }: { isActive: boolean }): string =>
    isActive ? 'rai-versions__link rai-versions__link--active' : 'rai-versions__link';
  return (
    <nav className="rai-versions" aria-label={t('version.nav_heading')}>
      <h2 className="rai-versions__title">{t('version.nav_heading')}</h2>
      <ol className="rai-versions__list">
        {draft !== null && (
          <li>
            <NavLink to={casePath(caseId)} end className={className}>
              <span className="rai-versions__name">
                {t('version.nav_draft', { number: draft.versionNumber })}
              </span>
              <StatusBadge status="draft" tone="neutral" label={t('status.draft')} />
              <span className="rai-muted rai-versions__meta">
                {t('case.field.updated_at')}
                {': '}
                <time dateTime={draft.updatedAt}>{formatDateTime(locale, draft.updatedAt)}</time>
              </span>
            </NavLink>
          </li>
        )}
        {versions.map((version) => (
          <li key={version.versionId}>
            <NavLink to={versionPath(caseId, version.versionId)} end className={className}>
              <span className="rai-versions__name">
                {t('version.nav_submitted', { number: version.versionNumber })}
              </span>
              {version.isLatest && <StatusBadge status="latest" tone="info" label={t('version.latest')} />}
              <span className="rai-muted rai-versions__meta">
                {t('version.submitted_by', { subject: version.submittedBy })}
                {' · '}
                <time dateTime={version.submittedAt}>{formatDateTime(locale, version.submittedAt)}</time>
              </span>
            </NavLink>
          </li>
        ))}
        {versions.length === 0 && <li className="rai-muted rai-versions__none">{t('version.nav_none')}</li>}
      </ol>
    </nav>
  );
}
