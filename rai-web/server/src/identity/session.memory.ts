// In-memory SessionStore with the same liveness rule as the Postgres store. Used by the unit tests that exercise the
// routes and the middleware without Postgres (ID-11, the middleware table). Not a W1-13 substitute: it holds no
// fixture data and is never selected by configuration.

import { uuidv7 } from '@rai/shared/ids';
import {
  LAST_SEEN_THROTTLE_MS,
  hashToken,
  isLive,
  newToken,
  type SessionRecord,
  type SessionStore,
} from './session.js';

export interface MemorySessionStore extends SessionStore {
  rows: Map<string, SessionRecord>; // by token hash
  refusals: Array<{ reason: string; issuerKey: string; subjectHashed: boolean }>;
  audit: string[]; // action names in order
}

export function createMemorySessionStore(): MemorySessionStore {
  const rows = new Map<string, SessionRecord>();
  const audit: string[] = [];
  const refusals: MemorySessionStore['refusals'] = [];
  const byId = (id: string) => [...rows.values()].find((r) => r.id === id);
  return {
    rows,
    audit,
    refusals,
    create(input) {
      const now = input.now ?? new Date();
      const token = newToken();
      const session: SessionRecord = {
        id: uuidv7(now.getTime()),
        subjectId: input.principal.subjectId,
        principal: structuredClone(input.principal),
        identityMode: input.identityMode,
        createdAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + input.absoluteHours * 3_600_000),
        revokedAt: null,
        locale: 'th',
      };
      rows.set(hashToken(token), session);
      audit.push('identity.signed_in');
      return Promise.resolve({ session, token });
    },
    resolve(token, policy, now = new Date()) {
      const row = rows.get(hashToken(token));
      if (row === undefined || !isLive(row, policy, now)) return Promise.resolve(undefined);
      if (now.getTime() - row.lastSeenAt.getTime() >= LAST_SEEN_THROTTLE_MS) row.lastSeenAt = now;
      return Promise.resolve(row);
    },
    revoke(sessionId, _correlationId, now = new Date()) {
      const row = byId(sessionId);
      if (row !== undefined && row.revokedAt === null) {
        row.revokedAt = now;
        audit.push('identity.signed_out');
      }
      return Promise.resolve();
    },
    setLocale(sessionId, locale) {
      const row = byId(sessionId);
      if (row !== undefined) row.locale = locale;
      return Promise.resolve();
    },
    recordSignInRefused(input) {
      refusals.push({
        reason: input.reason,
        issuerKey: input.issuerKey,
        subjectHashed: input.subject !== undefined,
      });
      audit.push('identity.sign_in_refused');
      return Promise.resolve();
    },
  };
}
