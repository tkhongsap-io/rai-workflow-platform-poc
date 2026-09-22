// W0-07 section 4.4: buildDedupKey is the W0-04 `notification` unique index (event, version_id, lane, recipient)
// as one string. The W1-11 sink tests (fixtures/src/substitutes/mail-sink/dedup-key.test.ts) cover the full 4.8
// row; this file proves the contract on its own so the amendment is self-verifying.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildDedupKey } from './dedup.js';
import type { AuthorizedRecipient, CaseMailEvent, MailDeliveryEvent } from './types.js';

const recipient = (address: string, recipientId = 'fx-user-ai-coe'): AuthorizedRecipient => ({
  recipientId,
  address,
  displayName: null,
  locale: 'th',
  basis: 'case_view_scope',
});

const event = (overrides: Partial<CaseMailEvent>): CaseMailEvent => ({
  kind: 'lane_opened',
  caseId: 'RAI-2026-0001',
  versionId: 'V',
  versionNumber: 1,
  digestDay: null,
  lane: 'ai_coe',
  auditEventId: '019966e0-0000-7000-8000-000000000001',
  committedAt: '2026-09-20T12:00:00Z',
  correlationId: '7d8f2a0e-1b2c-4d3e-9f00-000000000001',
  ...overrides,
});

test('lane_opened: the W0-04 event value, version, lane and address', () => {
  assert.equal(
    buildDedupKey(event({}), recipient('ai-coe@rai-desk.example')),
    'lane_open:V:ai_coe:ai-coe@rai-desk.example',
  );
});

test('recipientId is not part of the identity; the address is', () => {
  const e = event({});
  const a = buildDedupKey(e, recipient('ai-coe@rai-desk.example', 'fx-user-a'));
  const b = buildDedupKey(e, recipient('ai-coe@rai-desk.example', 'operator_recipients:1'));
  assert.equal(a, b);
  assert.notEqual(a, buildDedupKey(e, recipient('dpo@rai-desk.example', 'fx-user-a')));
});

test("ready_for_launch and the digest carry '-' for the lane; the digest day comes from event.digestDay only", () => {
  assert.equal(
    buildDedupKey(event({ kind: 'ready_for_launch', lane: null }), recipient('owner.cm@rai-desk.example')),
    'ready:V:-:owner.cm@rai-desk.example',
  );
  assert.equal(
    buildDedupKey(
      {
        kind: 'sla_breach_digest',
        caseId: null,
        versionId: null,
        versionNumber: null,
        lane: null,
        digestDay: '2026-09-21',
        committedAt: '2026-09-21T00:00:00Z',
        correlationId: 'job-correlation',
        provenance: {
          kind: 'sla_digest_job',
          jobRunId: 'job',
          digestDay: '2026-09-21',
          correlationId: 'job-correlation',
        },
      },
      recipient('operator-digest@rai-desk.example', 'operator_recipients:1'),
    ),
    'sla_breach_digest:2026-09-21:-:operator-digest@rai-desk.example',
  );
});

test('an incomplete identity throws a RangeError naming the field; no key contains null', () => {
  assert.throws(
    () => buildDedupKey(event({ versionId: null }), recipient('ai-coe@rai-desk.example')),
    (err: unknown) => err instanceof RangeError && err.message === 'event.versionId',
  );
  assert.throws(
    () =>
      buildDedupKey(
        { kind: 'sla_breach_digest', lane: null, digestDay: null } as unknown as MailDeliveryEvent,
        recipient('dpo@rai-desk.example'),
      ),
    (err: unknown) => err instanceof RangeError && err.message === 'event.digestDay',
  );
  assert.throws(
    () => buildDedupKey(event({ versionId: '' }), recipient('ai-coe@rai-desk.example')),
    (err: unknown) => err instanceof RangeError && err.message === 'event.versionId',
  );
});
