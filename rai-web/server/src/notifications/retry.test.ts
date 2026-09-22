import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DeliveryReceipt } from '@rai/shared/mail/types';
import { deliveryUpdate, nextAttempt, RETRY_BACKOFF_MS, type RetryState } from './retry.js';

const START = Date.parse('2026-09-22T00:00:00Z');
const failure = {
  status: 'failed',
  error: { code: 'sink_failure', message: 'synthetic' },
} satisfies Pick<DeliveryReceipt, 'status' | 'error'>;
const initial = (): RetryState => ({ status: 'queued', attempts: 0, nextAttemptAt: null });

test('four failed results: 0/1/6/31 seconds; no fifth attempt', () => {
  let state = initial();
  for (const [index, seconds] of [0, 1, 6, 31].entries()) {
    const now = new Date(START + seconds * 1000);
    const attempt = index + 1;
    assert.equal(nextAttempt(state, now), attempt);
    state = deliveryUpdate(attempt, failure, now);
    if (state.nextAttemptAt !== null) {
      assert.equal(nextAttempt(state, new Date(state.nextAttemptAt.getTime() - 1)), undefined);
      assert.equal(nextAttempt(state, state.nextAttemptAt), attempt + 1);
    }
  }
  assert.deepEqual(state, {
    status: 'failed',
    attempts: 4,
    nextAttemptAt: null,
    lastErrorCode: 'sink_failure',
  });
  assert.equal(nextAttempt(state, new Date(START + 1_000_000)), undefined);
  assert.throws(() => deliveryUpdate(5, failure, new Date(START)), RangeError);
});

test('backoff starts at failure completion; serialized deadlines survive reconstruction', () => {
  for (const attempt of [1, 2, 3]) {
    const completed = new Date(START + 800);
    const state = deliveryUpdate(attempt, failure, completed);
    assert.equal(state.nextAttemptAt!.getTime(), START + 800 + [1000, 5000, 25000][attempt - 1]!);
    const stored = JSON.parse(JSON.stringify(state)) as { nextAttemptAt: string };
    const restored = { ...state, nextAttemptAt: new Date(stored.nextAttemptAt) };
    assert.equal(nextAttempt(restored, new Date(restored.nextAttemptAt.getTime() - 1)), undefined);
    assert.equal(nextAttempt(restored, restored.nextAttemptAt), attempt + 1);
    assert.equal(nextAttempt(restored, new Date(START + 100_000)), attempt + 1);
    assert.equal(completed.getTime(), START + 800, 'input date is not mutated');
  }
});

test('delivery or duplicate on any attempt is terminal and clears retry/error state', () => {
  for (const attempt of [1, 2, 3, 4]) {
    for (const status of ['delivered', 'duplicate'] as const) {
      const result = deliveryUpdate(
        attempt,
        {
          status,
          error: status === 'duplicate' ? { code: 'duplicate', message: 'synthetic' } : null,
        },
        new Date(START),
      );
      assert.deepEqual(result, {
        status: 'sent',
        attempts: attempt,
        nextAttemptAt: null,
        lastErrorCode: null,
      });
      assert.equal(nextAttempt(result, new Date(START + 100_000)), undefined);
    }
  }
});

test('all failed receipt codes follow the same budget; cause remains available', () => {
  for (const code of ['sink_failure', 'malformed_request', 'rejected_recipient', 'unsafe_link'] as const) {
    const receipt = { status: 'failed', error: { code, message: 'synthetic' } } as const;
    assert.equal(deliveryUpdate(1, receipt, new Date(START)).status, 'queued');
    assert.equal(deliveryUpdate(4, receipt, new Date(START)).lastErrorCode, code);
  }
  assert.equal(
    deliveryUpdate(4, { status: 'failed', error: null }, new Date(START)).lastErrorCode,
    'sink_failure',
  );
});

test('eligibility fails closed for terminal/exhausted/invalid rows and unscheduled retries', () => {
  const now = new Date(START);
  for (const status of ['sent', 'failed'] as const) {
    assert.equal(nextAttempt({ ...initial(), status }, now), undefined);
  }
  for (const attempts of [-1, 0.5, NaN, Infinity, 4, 5]) {
    assert.equal(nextAttempt({ ...initial(), attempts }, now), undefined);
  }
  for (const attempts of [1, 2, 3]) {
    assert.equal(nextAttempt({ ...initial(), attempts }, now), undefined);
  }
  assert.equal(nextAttempt(initial(), new Date(NaN)), undefined);
  assert.equal(nextAttempt({ ...initial(), nextAttemptAt: new Date(NaN) }, now), undefined);
  assert.equal(nextAttempt({ ...initial(), nextAttemptAt: new Date(START + 1) }, now), undefined);
  assert.equal(nextAttempt({ ...initial(), nextAttemptAt: now }, now), 1);
});

test('reducer refuses invalid attempts/times; policy constants cannot be changed', () => {
  for (const attempt of [0, -1, 1.5, NaN, Infinity, 5]) {
    assert.throws(() => deliveryUpdate(attempt, failure, new Date(START)), RangeError);
  }
  assert.throws(() => deliveryUpdate(1, failure, new Date(NaN)), RangeError);
  assert.throws(() => deliveryUpdate(1, failure, new Date(8_640_000_000_000_000)), RangeError);
  assert.equal(Object.isFrozen(RETRY_BACKOFF_MS), true);
});
