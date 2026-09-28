// W7-07 (W7 plan section 5.3, W7-D20 option B): the in-memory mail recipient directory. Fixed over the fixture
// identities in `fixture` mode (the same values composeAppDeps derived before); live outside it, loaded from the
// `subject_profile` rows of the running identity mode and refreshed one row at a time by the W7-06 `recorded` hook.
// A static value and the directory's function give the same notices. No Postgres: the profile reader is injected.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CommittedEvent } from '@rai/shared/mail/types';
import type { RoleScope } from '@rai/shared/schemas/auth';
import type { SubjectProfile } from '../identity/session.js';
import {
  laneOpenRecipientsForCase,
  laneOpenRecipientsFromIdentities,
  laneReviewerSpocUnits,
} from '../versions/open-lanes.js';
import { sendBackRecipientsFromIdentities } from '../workflow/send-back-notice.js';
import { resolveRecipient, type MailIdentity } from './compose.js';
import { createRecipientDirectory, current } from './directory.js';

const role = (r: string, scope: RoleScope['scope']): RoleScope => ({ role: r, scope }) as RoleScope;
const users: MailIdentity[] = [
  {
    subjectId: 'fixture:owner',
    email: 'owner@rai-desk.example',
    displayName: 'Owner (synthetic)',
    roles: [role('owner', { kind: 'own_cases' })],
  },
  {
    subjectId: 'fixture:dpo',
    email: 'dpo@rai-desk.example',
    displayName: 'DPO (synthetic)',
    roles: [
      role('dpo', { kind: 'all_cases', lane: 'dpo' }),
      role('bu_spoc', { kind: 'business_unit', businessUnit: 'HR' }),
    ],
  },
  {
    subjectId: 'fixture:ai-coe',
    email: 'ai-coe@rai-desk.example',
    displayName: 'AI CoE (synthetic)',
    roles: [role('ai_coe', { kind: 'all_cases', lane: 'ai_coe' })],
  },
];

function profile(
  overrides: Partial<SubjectProfile> & Pick<SubjectProfile, 'subjectId' | 'email'>,
): SubjectProfile {
  return {
    identityMode: 'local-google',
    displayName: 'Synthetic person',
    roles: [role('owner', { kind: 'own_cases' })],
    firstSeenAt: new Date('2026-09-28T01:00:00Z'),
    lastSignInAt: new Date('2026-09-28T01:00:00Z'),
    ...overrides,
  };
}

const event: CommittedEvent = {
  kind: 'lane_opened',
  caseId: 'case-1',
  versionId: 'version-1',
  versionNumber: 1,
  lane: 'dpo',
  digestDay: null,
  auditEventId: 'audit-1',
  correlationId: 'correlation-1',
  committedAt: '2026-09-28T00:00:00Z',
};
const facts = { caseId: 'case-1', ownerSubjectId: 'fixture:owner', businessUnitId: 'CM' };

test('W7-07: current() returns a static value as is and calls a function', () => {
  const value = { a: 1 };
  assert.equal(current(value), value);
  assert.equal(
    current(() => value),
    value,
  );
});

test('W7-07: a fixed directory gives exactly the values composeAppDeps derived from the fixture identities', async () => {
  const dir = createRecipientDirectory({ fixtureUsers: users });
  assert.equal(dir.live, false);
  assert.equal(dir.identities(), users);
  assert.deepEqual(dir.laneOpenRecipients(), laneOpenRecipientsFromIdentities(users));
  assert.deepEqual(dir.laneReviewerSpocUnits(), laneReviewerSpocUnits(users));
  assert.deepEqual(
    dir.ownerRecipients('fixture:owner'),
    sendBackRecipientsFromIdentities(users, 'fixture:owner'),
  );
  dir.recorded(profile({ subjectId: 'google:x', email: 'x@rai-desk.example' }));
  assert.equal(dir.identities(), users, 'a fixed directory ignores recorded profiles');
  await assert.rejects(dir.load({} as never), /fixed/);
});

test('W7-07: a static value and the directory function give the same notices (lane open, SPOC exclusion, recipient)', () => {
  const dir = createRecipientDirectory({ fixtureUsers: users });
  for (const bu of ['CM', 'HR']) {
    assert.deepEqual(
      laneOpenRecipientsForCase(current(dir.laneOpenRecipients), current(dir.laneReviewerSpocUnits), bu),
      laneOpenRecipientsForCase(laneOpenRecipientsFromIdentities(users), laneReviewerSpocUnits(users), bu),
    );
  }
  assert.deepEqual(
    resolveRecipient(current(dir.identities), 'dpo@rai-desk.example', event, facts),
    resolveRecipient(users, 'dpo@rai-desk.example', event, facts),
  );
});

test('W7-07: a live directory starts empty, loads the profiles of its identity mode only, and derives every view', async () => {
  const modes: string[] = [];
  const dir = createRecipientDirectory({
    identityMode: 'local-google',
    readProfiles: (_db, mode) => {
      modes.push(mode);
      return Promise.resolve([
        profile({
          subjectId: 'google:dpo',
          email: 'dpo@rai-desk.example',
          roles: users[1]!.roles as RoleScope[],
        }),
        profile({ subjectId: 'google:owner', email: 'owner@rai-desk.example' }),
      ]);
    },
  });
  assert.equal(dir.live, true);
  assert.deepEqual(dir.identities(), []);
  assert.deepEqual(dir.laneOpenRecipients(), { ai_coe: [], dpo: [], it_security: [] });
  await dir.load({} as never);
  assert.deepEqual(modes, ['local-google']);
  assert.deepEqual(
    dir.identities().map((u) => u.subjectId),
    ['google:dpo', 'google:owner'],
  );
  assert.deepEqual(dir.laneOpenRecipients(), { ai_coe: [], dpo: ['dpo@rai-desk.example'], it_security: [] });
  assert.deepEqual(dir.laneReviewerSpocUnits(), { 'dpo@rai-desk.example': ['HR'] });
  assert.deepEqual(dir.ownerRecipients('google:owner'), ['owner@rai-desk.example']);
  assert.deepEqual(dir.ownerRecipients('google:nobody'), []);
  // A profile of another identity mode (left from an earlier configuration) is never a recipient.
  dir.recorded(profile({ subjectId: 'oidc:abc:x', email: 'x@rai-desk.example', identityMode: 'network' }));
  assert.equal(dir.identities().length, 2);
});

test('W7-07: recorded() adds a person who signs in after start and replaces an earlier snapshot of the same subject', async () => {
  const dir = createRecipientDirectory({ identityMode: 'network', readProfiles: () => Promise.resolve([]) });
  await dir.load({} as never);
  dir.recorded(
    profile({
      subjectId: 'oidc:1:ai',
      email: 'ai@rai-desk.example',
      identityMode: 'network',
      roles: [role('ai_coe', { kind: 'all_cases', lane: 'ai_coe' })],
    }),
  );
  assert.deepEqual(dir.laneOpenRecipients().ai_coe, ['ai@rai-desk.example']);
  dir.recorded(
    profile({
      subjectId: 'oidc:1:ai',
      email: 'ai@rai-desk.example',
      identityMode: 'network',
      roles: [role('owner', { kind: 'own_cases' })],
      lastSignInAt: new Date('2026-09-28T02:00:00Z'),
    }),
  );
  assert.deepEqual(dir.laneOpenRecipients().ai_coe, [], 'the role snapshot of the latest sign-in wins');
  assert.equal(dir.identities().length, 1);
});

test('W7-07: a load that finishes after a newer sign-in never replaces the newer snapshot', async () => {
  let resolveRead!: (rows: SubjectProfile[]) => void;
  const dir = createRecipientDirectory({
    identityMode: 'local-google',
    readProfiles: () => new Promise((resolve) => (resolveRead = resolve)),
  });
  const loading = dir.load({} as never);
  const newer = profile({
    subjectId: 'google:a',
    email: 'a@rai-desk.example',
    displayName: 'Newer',
    lastSignInAt: new Date('2026-09-28T05:00:00Z'),
  });
  dir.recorded(newer);
  resolveRead([profile({ subjectId: 'google:a', email: 'a@rai-desk.example', displayName: 'Older' })]);
  await loading;
  assert.deepEqual(
    dir.identities().map((u) => u.displayName),
    ['Newer'],
  );
});

test('W7-07: a failed load rejects, and the next read retries it in the background until it succeeds', async () => {
  let calls = 0;
  const retryErrors: unknown[] = [];
  const dir = createRecipientDirectory({
    identityMode: 'local-google',
    readProfiles: () => {
      calls += 1;
      return calls < 3
        ? Promise.reject(new Error('synthetic outage'))
        : Promise.resolve([profile({ subjectId: 'google:o', email: 'o@rai-desk.example' })]);
    },
    onRetryError: (err) => retryErrors.push(err),
  });
  await assert.rejects(dir.load({} as never), /synthetic outage/);
  assert.deepEqual(dir.identities(), [], 'the read answers from the current snapshot and schedules a retry');
  await dir.settled();
  assert.equal(calls, 2);
  assert.equal(retryErrors.length, 1);
  dir.identities();
  dir.identities(); // one retry at a time
  await dir.settled();
  assert.equal(calls, 3);
  assert.deepEqual(
    dir.identities().map((u) => u.subjectId),
    ['google:o'],
  );
  dir.identities();
  await dir.settled();
  assert.equal(calls, 3, 'no reload once loaded');
});
