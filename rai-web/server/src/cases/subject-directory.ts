// Resolves a `SubjectId` (the W0-02 7.3 `businessOwner` body field, stored in W0-04 `case.owner_subject_id`) to the
// display name the server writes into the descriptive `business_owner` column at create and at every owner change
// (W0-04 `case` row, W0-05 section 8 reconciliation). A subject that does not resolve is 422 invalid_input (W0-05
// "Create target"). Sources, in order: subjects handed in at construction (the fixture identities in fixture mode),
// the acting principal, then any subject that has signed in through the identity adapter (the `session` table's
// stored principal, newest row first). No directory call leaves the process; nothing here reads an email.

import { desc, eq } from 'drizzle-orm';
import type { Principal } from '@rai/shared/schemas/auth';
import type { Executor } from '../db/client.js';
import { session } from '../db/schema/session.js';

export interface ResolvedSubject {
  subjectId: string;
  displayName: string;
}

export interface SubjectDirectory {
  /** The display name for a subject, or undefined when no source knows it. */
  resolve(
    subjectId: string,
    actor?: Pick<Principal, 'subjectId' | 'displayName'>,
  ): Promise<ResolvedSubject | undefined>;
}

export interface SubjectDirectoryOptions {
  /** Subjects known at start-up (fixture mode: the eight W0-03 identities). */
  known?: Iterable<Pick<Principal, 'subjectId' | 'displayName'>>;
}

export function createSubjectDirectory(
  exec: Executor,
  options: SubjectDirectoryOptions = {},
): SubjectDirectory {
  const known = new Map<string, string>();
  for (const p of options.known ?? []) known.set(p.subjectId, p.displayName);
  return {
    async resolve(subjectId, actor) {
      const fromKnown = known.get(subjectId);
      if (fromKnown !== undefined) return { subjectId, displayName: fromKnown };
      if (actor !== undefined && actor.subjectId === subjectId)
        return { subjectId, displayName: actor.displayName };
      const [row] = await exec
        .select({ principal: session.principal })
        .from(session)
        .where(eq(session.subjectId, subjectId))
        .orderBy(desc(session.createdAt))
        .limit(1);
      const principal = row?.principal as Partial<Principal> | undefined;
      if (principal === undefined || typeof principal.displayName !== 'string') return undefined;
      return { subjectId, displayName: principal.displayName };
    },
  };
}

/**
 * W3-F1: one read's name lookup. Each subject is resolved at most once per read; an unknown subject yields undefined,
 * so the read omits the name rather than guessing. Names are display only and never decide access.
 */
export function readNames(
  subjects: SubjectDirectory | undefined,
): (subjectId: string) => Promise<string | undefined> {
  const memo = new Map<string, Promise<string | undefined>>();
  return (subjectId) => {
    if (subjects === undefined) return Promise.resolve(undefined);
    let hit = memo.get(subjectId);
    if (hit === undefined) {
      hit = subjects.resolve(subjectId).then((r) => r?.displayName);
      memo.set(subjectId, hit);
    }
    return hit;
  };
}

/** A directory over a fixed table only (unit tests, the W1-13 substitute). */
export function createStaticSubjectDirectory(
  known: Iterable<Pick<Principal, 'subjectId' | 'displayName'>>,
): SubjectDirectory {
  const map = new Map<string, string>();
  for (const p of known) map.set(p.subjectId, p.displayName);
  return {
    resolve(subjectId, actor) {
      const name = map.get(subjectId) ?? (actor?.subjectId === subjectId ? actor.displayName : undefined);
      return Promise.resolve(name === undefined ? undefined : { subjectId, displayName: name });
    },
  };
}
