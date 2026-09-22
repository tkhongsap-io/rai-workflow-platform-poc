// W0-07 section 4.8 "dedup key is the W0-04 identity": buildDedupKey (shared/src/mail/dedup.ts) builds the
// UNIQUE (event, version_id, lane, recipient) tuple as one string, using the W0-04 `event` value, the address
// (not the recipientId) and, for the digest, `event.digestDay` and nothing else.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDedupKey } from '@rai/shared/mail/dedup';
import { AI_COE_RECIPIENT, digestEvent, laneOpenedEvent, VERSION_ID } from './support.js';

test('lane_opened on version V opening ai_coe uses the W0-04 event value lane_open, not lane_opened', () => {
  const key = buildDedupKey(laneOpenedEvent(), AI_COE_RECIPIENT);
  assert.equal(key, `lane_open:${VERSION_ID}:ai_coe:ai-coe@rai-desk.example`);
  assert.ok(!key.startsWith('lane_opened:'));
});

test('the address, not the recipientId, is the fourth component: two subject IDs at one address are one key', () => {
  const event = laneOpenedEvent();
  const asOwner = { ...AI_COE_RECIPIENT, recipientId: 'fixture:owner-cm', basis: 'case_view_scope' as const };
  const asOperator = {
    ...AI_COE_RECIPIENT,
    recipientId: 'operator_recipients:1',
    basis: 'operator_recipients' as const,
  };
  assert.equal(buildDedupKey(event, asOwner), buildDedupKey(event, asOperator));
  const other = { ...AI_COE_RECIPIENT, address: 'dpo@rai-desk.example' };
  assert.notEqual(buildDedupKey(event, asOwner), buildDedupKey(event, other));
});

test('sent_back carries the deciding lane; ready_for_launch carries - for the lane', () => {
  const sentBack = laneOpenedEvent({ kind: 'sent_back', lane: 'dpo' });
  assert.equal(
    buildDedupKey(sentBack, AI_COE_RECIPIENT),
    `send_back:${VERSION_ID}:dpo:ai-coe@rai-desk.example`,
  );
  const ready = laneOpenedEvent({ kind: 'ready_for_launch', lane: null });
  assert.equal(buildDedupKey(ready, AI_COE_RECIPIENT), `ready:${VERSION_ID}:-:ai-coe@rai-desk.example`);
});

test('the digest key takes the day from event.digestDay and from nothing else (committedAt is the previous day)', () => {
  const event = digestEvent({ digestDay: '2026-09-21', committedAt: '2026-09-20T12:00:00Z' });
  assert.equal(event.versionId, null);
  assert.equal(event.caseId, null);
  assert.equal(event.lane, null);
  assert.equal(
    buildDedupKey(event, AI_COE_RECIPIENT),
    'sla_breach_digest:2026-09-21:-:ai-coe@rai-desk.example',
  );
});

test('an incomplete identity throws a RangeError naming the field; no key containing null is ever built', () => {
  assert.throws(
    () => buildDedupKey(digestEvent({ digestDay: null as unknown as string }), AI_COE_RECIPIENT),
    (err: unknown) => err instanceof RangeError && err.message === 'event.digestDay',
  );
  assert.throws(
    () => buildDedupKey(laneOpenedEvent({ versionId: null }), AI_COE_RECIPIENT),
    (err: unknown) => err instanceof RangeError && err.message === 'event.versionId',
  );
  assert.throws(
    () => buildDedupKey(laneOpenedEvent({ versionId: '' }), AI_COE_RECIPIENT),
    (err: unknown) => err instanceof RangeError && err.message === 'event.versionId',
  );
});
