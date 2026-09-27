import type { SessionInfo } from '@rai/shared/schemas/auth';
import type { LocaleKey } from '@rai/shared/locales/keys';
import type { DeskHealthReport, ReadinessReport } from '@rai/shared/schemas/observability';

/** Presentation only: the server still enforces operator.view. */
export function isOperatorAdmin(session: SessionInfo | undefined): boolean {
  return session?.principal.roles.some(({ role }) => role === 'admin') === true;
}

/** Presentation only: offers 'New case' to the roles that hold case.create; the server still decides. */
export function canCreateCase(session: SessionInfo): boolean {
  return session.principal.roles.some(({ role }) => role === 'owner' || role === 'bu_spoc');
}

export type OperatorResult = {
  session: SessionInfo;
  generation: number;
} & ({ kind: 'loaded'; report: DeskHealthReport } | { kind: 'failed'; error: unknown });

/** Checked during render, before effects: even a same-subject replacement invalidates old data. */
export function visibleOperatorResult(
  result: OperatorResult | undefined,
  session: SessionInfo | undefined,
  generation: number,
): OperatorResult | undefined {
  return isOperatorAdmin(session) && result?.session === session && result?.generation === generation
    ? result
    : undefined;
}

/**
 * W7-03 (W7 plan section 7): `ahead` (the database is newer than this build, by additive migrations only) is served
 * but shown as a warning with its explanatory note; every other migrations value renders as a plain status.
 */
export function migrationsDisplay(value: ReadinessReport['store']['migrations']): {
  tone?: 'warn';
  noteKey?: LocaleKey;
} {
  return value === 'ahead' ? { tone: 'warn', noteKey: 'operator.field.migrations_ahead_note' } : {};
}
