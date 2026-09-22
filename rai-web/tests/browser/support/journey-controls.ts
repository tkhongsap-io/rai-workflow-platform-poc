// Closed IPC protocol, deliberately absent from application HTTP/env configuration.
export type JourneyCommand =
  | { id: string; command: 'bindCase'; caseId: string }
  | { id: string; command: 'mailFailure'; enabled: boolean }
  | { id: string; command: 'submitTimeout'; enabled: boolean }
  | { id: string; command: 'advanceRetry'; notificationId: string; expectedAttempts: 1 | 2 | 3 };
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
export function isJourneyCommand(value: unknown): value is JourneyCommand {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!uuid(v.id)) return false;
  const keys = Object.keys(v).sort().join(',');
  if (v.command === 'bindCase') return keys === 'caseId,command,id' && uuid(v.caseId);
  if (v.command === 'mailFailure' || v.command === 'submitTimeout')
    return keys === 'command,enabled,id' && typeof v.enabled === 'boolean';
  return (
    v.command === 'advanceRetry' &&
    keys === 'command,expectedAttempts,id,notificationId' &&
    uuid(v.notificationId) &&
    [1, 2, 3].includes(v.expectedAttempts as number)
  );
}
