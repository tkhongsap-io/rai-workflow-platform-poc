// W7-07 (W7 plan section 5.3, register row "W7 delegated rulings (provisional)" W7-D20 option B): the mail recipient
// directory. In `fixture` mode it is fixed over the fixture identities, giving exactly the values composeAppDeps
// derived before. Outside it, it is live: the `subject_profile` rows of the running identity mode (W7-06, W7-D10
// option A) loaded once before `listen`, then replaced one row at a time by the `profiles.recorded` hook after each
// committed sign-in. Every view is synchronous and recomputed from the current snapshot, so the version, workflow,
// findings and notification services read it without becoming async. Sound because the deployable is one process
// (W7 plan section 12 known limits). A person who never signed in has no profile and gets no mail. Members are
// function properties, not methods, so consumers may take them unbound (`recipients.identities`).

import { eq } from 'drizzle-orm';
import type { IdentityMode, RoleScope } from '@rai/shared/schemas/auth';
import type { Db } from '../db/client.js';
import { subjectProfile } from '../db/schema/subject-profile.js';
import type { SubjectProfile } from '../identity/session.js';
import {
  laneOpenRecipientsFromIdentities,
  laneReviewerSpocUnits,
  type LaneOpenRecipients,
  type LaneReviewerSpocUnits,
} from '../versions/open-lanes.js';
import { sendBackRecipientsFromIdentities } from '../workflow/send-back-notice.js';
import type { MailIdentity } from './compose.js';

/** A dependency fixed at composition or read at each use (W7-D20 option B: one `T | (() => T)` widening). */
export type Live<T> = T | (() => T);

/** The value of a `Live` dependency now. */
export function current<T>(value: Live<T>): T {
  return typeof value === 'function' ? (value as () => T)() : value;
}

export type ProfileReader = (db: Db, mode: IdentityMode) => Promise<readonly SubjectProfile[]>;

export interface RecipientDirectory {
  /** False for the fixed fixture directory; true when it follows `subject_profile`. */
  readonly live: boolean;
  /** Loads the profiles of the directory's identity mode; rejects on a read failure (then retried on a later read). */
  load: (db: Db) => Promise<void>;
  /** The W7-06 hook: one committed profile replaces the subject's earlier snapshot. */
  recorded: (profile: SubjectProfile) => void;
  identities: () => readonly MailIdentity[];
  laneOpenRecipients: () => LaneOpenRecipients;
  laneReviewerSpocUnits: () => LaneReviewerSpocUnits;
  ownerRecipients: (ownerSubjectId: string) => readonly string[];
  /** Resolves when no background reload is in flight (tests and shutdown). */
  settled: () => Promise<void>;
}

export type RecipientDirectoryInput =
  | { fixtureUsers: readonly MailIdentity[] }
  | {
      identityMode: IdentityMode;
      /** Test seam; defaults to a `subject_profile` read as rai_app. */
      readProfiles?: ProfileReader;
      /** Where a failed background reload is reported (start.ts binds `errors.internal`). */
      onRetryError?: (err: unknown) => void;
    };

export const readSubjectProfiles: ProfileReader = async (db, mode) => {
  const rows = await db.select().from(subjectProfile).where(eq(subjectProfile.identityMode, mode));
  return rows.map((row) => ({
    subjectId: row.subjectId,
    identityMode: row.identityMode as IdentityMode,
    email: row.email,
    displayName: row.displayName,
    roles: row.roles as RoleScope[],
    firstSeenAt: row.firstSeenAt,
    lastSignInAt: row.lastSignInAt,
  }));
};

interface Views {
  identities: readonly MailIdentity[];
  laneOpen: LaneOpenRecipients;
  spocUnits: LaneReviewerSpocUnits;
}

function viewsOf(identities: readonly MailIdentity[]): Views {
  return {
    identities,
    laneOpen: laneOpenRecipientsFromIdentities(identities),
    spocUnits: laneReviewerSpocUnits(identities),
  };
}

export function createRecipientDirectory(input: RecipientDirectoryInput): RecipientDirectory {
  if ('fixtureUsers' in input) {
    const views = viewsOf(input.fixtureUsers);
    return {
      live: false,
      load: () => Promise.reject(new Error('a fixed recipient directory is not loaded')),
      recorded: () => undefined, // fixture identities are known at start-up; fixture sign-ins write no profile
      identities: () => views.identities,
      laneOpenRecipients: () => views.laneOpen,
      laneReviewerSpocUnits: () => views.spocUnits,
      ownerRecipients: (owner) => sendBackRecipientsFromIdentities(views.identities, owner),
      settled: () => Promise.resolve(),
    };
  }

  const { identityMode, onRetryError } = input;
  const read = input.readProfiles ?? readSubjectProfiles;
  const bySubject = new Map<string, SubjectProfile>();
  let views: Views | undefined;
  let loadedFrom: Db | undefined; // the handle a failed load retries with
  let loaded = false;
  let retry: Promise<void> | undefined;

  /** Keeps the newer snapshot of a subject: a load that finishes after a sign-in never overwrites it. */
  function merge(profile: SubjectProfile): void {
    if (profile.identityMode !== identityMode) return; // left from another configuration: never a recipient
    const known = bySubject.get(profile.subjectId);
    if (known !== undefined && known.lastSignInAt.getTime() > profile.lastSignInAt.getTime()) return;
    bySubject.set(profile.subjectId, profile);
    views = undefined;
  }

  async function loadFrom(db: Db): Promise<void> {
    loadedFrom = db;
    const rows = await read(db, identityMode);
    for (const row of rows) merge(row);
    loaded = true;
  }

  function snapshot(): Views {
    if (!loaded && loadedFrom !== undefined && retry === undefined) {
      const db = loadedFrom;
      retry = loadFrom(db)
        .catch((err: unknown) => onRetryError?.(err))
        .finally(() => {
          retry = undefined;
        });
    }
    views ??= viewsOf(
      [...bySubject.values()]
        .sort((a, b) => (a.subjectId < b.subjectId ? -1 : a.subjectId > b.subjectId ? 1 : 0))
        .map((p) => ({ subjectId: p.subjectId, email: p.email, displayName: p.displayName, roles: p.roles })),
    );
    return views;
  }

  return {
    live: true,
    load: loadFrom,
    recorded: merge,
    identities: () => snapshot().identities,
    laneOpenRecipients: () => snapshot().laneOpen,
    laneReviewerSpocUnits: () => snapshot().spocUnits,
    ownerRecipients: (owner) => sendBackRecipientsFromIdentities(snapshot().identities, owner),
    settled: async () => {
      while (retry !== undefined) await retry;
    },
  };
}
