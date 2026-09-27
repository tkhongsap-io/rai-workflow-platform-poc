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
  type SubjectProfile,
} from './session.js';

export interface MemorySessionStore extends SessionStore {
  rows: Map<string, SessionRecord>; // by token hash
  refusals: Array<{ reason: string; issuerKey: string; subjectHashed: boolean }>;
  audit: string[]; // action names in order
  profiles: Map<string, SubjectProfile>; // W7-06: by subject id
}

export function createMemorySessionStore(): MemorySessionStore {
  const rows = new Map<string, SessionRecord>();
  const audit: string[] = [];
  const refusals: MemorySessionStore['refusals'] = [];
  const profiles = new Map<string, SubjectProfile>();
  const byId = (id: string) => [...rows.values()].find((r) => r.id === id);
  return {
    rows,
    audit,
    refusals,
    profiles,
    create(input) {
      const now = input.now ?? new Date();
      // W7-06: the Postgres CHECK refuses a fixture-mode profile and the transaction leaves nothing behind.
      if (input.profile !== undefined && input.identityMode === 'fixture')
        return Promise.reject(new Error('subject_profile_identity_mode_check'));
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
      if (input.profile === undefined) return Promise.resolve({ session, token });
      const previous = profiles.get(input.principal.subjectId);
      const profile: SubjectProfile = {
        subjectId: input.principal.subjectId,
        identityMode: input.identityMode,
        email: input.profile.email,
        displayName: input.profile.displayName,
        roles: structuredClone(input.principal.roles),
        firstSeenAt: previous?.firstSeenAt ?? now,
        lastSignInAt: now,
      };
      profiles.set(profile.subjectId, profile);
      return Promise.resolve({ session, token, profile: structuredClone(profile) });
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
