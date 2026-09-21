// W0-03 section 6.3: server-side sessions in Postgres, one row per session, an opaque cookie. The cookie value is a
// 256-bit random string; the row is found by its SHA-256, so there is no signing key. A request is authenticated
// when the hash matches a row that is not revoked, not past its absolute expiry and not idle-expired; lastSeenAt is
// written at most once per minute. Sign-in always creates a new row (no fixation). The store is an interface so
// the route unit tests (ID-11) run with an in-memory implementation and no Postgres.

import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { uuidv7 } from '@rai/shared/ids';
import type { IdentityMode, Locale, Principal } from '@rai/shared/schemas/auth';
import { auditStore } from '../audit/store.js';
import type { Db, Executor } from '../db/client.js';
import { session as sessionTable } from '../db/schema/session.js';
import { withTransaction } from '../db/transaction.js';
import type { SignInReasonCode } from './types.js';

export const SESSION_COOKIE_SECURE = '__Host-rai_session';
export const SESSION_COOKIE_PLAIN = 'rai_session';
export const TRANSACTION_COOKIE_SECURE = '__Host-rai_signin';
export const TRANSACTION_COOKIE_PLAIN = 'rai_signin';
export const LAST_SEEN_THROTTLE_MS = 60 * 1000;

export interface SessionRecord {
  id: string;
  subjectId: string;
  principal: Principal;
  identityMode: IdentityMode;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  locale: Locale;
}

export interface CreateSessionInput {
  principal: Principal;
  identityMode: IdentityMode;
  absoluteHours: number;
  correlationId: string;
  now?: Date;
}

export interface SessionStore {
  /** Creates a new row and returns the cookie value once; writes `identity.signed_in` in the same transaction. */
  create(input: CreateSessionInput): Promise<{ session: SessionRecord; token: string }>;
  /** The live session for a cookie value, or undefined (no row, revoked, expired, idle-expired). Touches lastSeenAt (throttled). */
  resolve(token: string, policy: { idleMinutes: number }, now?: Date): Promise<SessionRecord | undefined>;
  /** Sign-out: marks the row revoked and writes `identity.signed_out`. */
  revoke(sessionId: string, correlationId: string, now?: Date): Promise<void>;
  setLocale(sessionId: string, locale: Locale): Promise<void>;
  /** `identity.sign_in_refused` (section 10): reason code, issuer key and a hash of the provider subject; never the email. */
  recordSignInRefused(input: {
    identityMode: IdentityMode;
    reason: SignInReasonCode;
    issuerKey: string;
    subject: string | undefined;
    correlationId: string;
  }): Promise<void>;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function subjectHash(subject: string): string {
  return createHash('sha256').update(subject).digest('hex');
}

/** `role:scopeKind[:bu]` summaries for the audit row (section 10). */
export function rolesSummary(principal: Principal): string[] {
  return principal.roles.map((r) =>
    r.scope.kind === 'business_unit'
      ? `${r.role}:${r.scope.kind}:${r.scope.businessUnit}`
      : `${r.role}:${r.scope.kind}`,
  );
}

/** Cookie names follow the public base URL scheme (section 6.3): `__Host-` + Secure on https, plain on loopback http. */
export function cookieNames(publicBaseUrl: URL): { session: string; transaction: string; secure: boolean } {
  const secure = publicBaseUrl.protocol === 'https:';
  return {
    session: secure ? SESSION_COOKIE_SECURE : SESSION_COOKIE_PLAIN,
    transaction: secure ? TRANSACTION_COOKIE_SECURE : TRANSACTION_COOKIE_PLAIN,
    secure,
  };
}

/** Pure liveness rule over a row (also used by the in-memory store in tests). */
export function isLive(row: SessionRecord, policy: { idleMinutes: number }, now: Date): boolean {
  if (row.revokedAt !== null) return false;
  if (row.expiresAt.getTime() <= now.getTime()) return false;
  if (row.lastSeenAt.getTime() <= now.getTime() - policy.idleMinutes * 60 * 1000) return false;
  return true;
}

function toRecord(row: typeof sessionTable.$inferSelect): SessionRecord {
  return {
    id: row.id,
    subjectId: row.subjectId,
    principal: row.principal as Principal,
    identityMode: row.identityMode as IdentityMode,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    locale: row.locale as Locale,
  };
}

export function createPgSessionStore(db: Db): SessionStore {
  return {
    async create(input) {
      const now = input.now ?? new Date();
      const token = newToken();
      const id = uuidv7(now.getTime());
      const expiresAt = new Date(now.getTime() + input.absoluteHours * 60 * 60 * 1000);
      const session = await withTransaction(db, async (tx) => {
        const [row] = await tx
          .insert(sessionTable)
          .values({
            id,
            tokenHash: hashToken(token),
            subjectId: input.principal.subjectId,
            principal: input.principal,
            identityMode: input.identityMode,
            createdAt: now,
            lastSeenAt: now,
            expiresAt,
            revokedAt: null,
            locale: 'th',
          })
          .returning();
        await auditStore.append(tx, {
          actorSubjectId: input.principal.subjectId,
          actorRole: input.principal.roles[0]?.role ?? 'none',
          action: 'identity.signed_in',
          targetRef: {
            session_id: id,
            identity_mode: input.identityMode,
            roles: rolesSummary(input.principal),
          },
          correlationId: input.correlationId,
          occurredAt: now,
        });
        return toRecord(row!);
      });
      return { session, token };
    },

    async resolve(token, policy, now = new Date()) {
      const [row] = await db
        .select()
        .from(sessionTable)
        .where(eq(sessionTable.tokenHash, hashToken(token)))
        .limit(1);
      if (row === undefined) return undefined;
      const record = toRecord(row);
      if (!isLive(record, policy, now)) return undefined;
      if (now.getTime() - record.lastSeenAt.getTime() >= LAST_SEEN_THROTTLE_MS) {
        await db.update(sessionTable).set({ lastSeenAt: now }).where(eq(sessionTable.id, record.id));
        record.lastSeenAt = now;
      }
      return record;
    },

    async revoke(sessionId, correlationId, now = new Date()) {
      await withTransaction(db, async (tx) => {
        const [row] = await tx
          .update(sessionTable)
          .set({ revokedAt: now })
          .where(and(eq(sessionTable.id, sessionId), isNull(sessionTable.revokedAt)))
          .returning();
        if (row === undefined) return;
        await auditStore.append(tx, {
          actorSubjectId: row.subjectId,
          actorRole: (row.principal as Principal).roles[0]?.role ?? 'none',
          action: 'identity.signed_out',
          targetRef: { session_id: sessionId },
          correlationId,
          occurredAt: now,
        });
      });
    },

    async setLocale(sessionId, locale) {
      await db.update(sessionTable).set({ locale }).where(eq(sessionTable.id, sessionId));
    },

    async recordSignInRefused(input) {
      await withTransaction(db, (tx) =>
        auditStore.append(tx, {
          actorSubjectId: 'anonymous',
          actorRole: 'none',
          action: 'identity.sign_in_refused',
          targetRef: {
            identity_mode: input.identityMode,
            reason: input.reason,
            issuer_key: input.issuerKey,
            subject_hash: input.subject === undefined ? null : subjectHash(input.subject),
          },
          correlationId: input.correlationId,
        }),
      );
    },
  };
}

/** Removes expired and revoked rows (section 6.3: not retained). Runs as rai_operator (`db:cleanup`), never as rai_app. */
export async function sweepSessions(exec: Executor, now: Date = new Date()): Promise<number> {
  const result = await exec
    .delete(sessionTable)
    .where(or(lt(sessionTable.expiresAt, now), sql`${sessionTable.revokedAt} IS NOT NULL`))
    .returning({ id: sessionTable.id });
  return result.length;
}
