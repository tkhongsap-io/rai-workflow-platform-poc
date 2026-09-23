import type { SessionInfo } from '@rai/shared/schemas/auth';
import type { DeskHealthReport } from '@rai/shared/schemas/observability';

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
