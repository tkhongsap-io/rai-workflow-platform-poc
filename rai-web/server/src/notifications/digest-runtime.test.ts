import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDailyDigestSchedule, untilNextBangkokDay } from './digest-runtime.js';

test('Bangkok midnight clock is Gregorian and strictly next-day', () => {
  assert.equal(untilNextBangkokDay(new Date('2026-09-22T16:59:59Z')), 1000);
  assert.equal(untilNextBangkokDay(new Date('2026-09-22T17:00:00Z')), 86_400_000);
});
test('startup runs once, tracks active work, schedules next day and abort cancels timer', async () => {
  const controller = new AbortController();
  const gate = Promise.withResolvers<void>();
  let count = 0;
  let callback: (() => void) | undefined;
  let delay = 0;
  let cancelled = false;
  const tasks: Promise<void>[] = [];
  const schedule = createDailyDigestSchedule({
    signal: controller.signal,
    track: (task) => {
      tasks.push(task);
    },
    onError: () => assert.fail('unexpected'),
    run: async () => {
      count++;
      await gate.promise;
    },
    clock: {
      now: () => new Date('2026-09-22T16:59:59Z'),
      schedule: (fn, ms) => {
        callback = fn;
        delay = ms;
        return 1;
      },
      cancel: () => {
        cancelled = true;
      },
    },
  });
  const running = schedule.start();
  assert.equal(schedule.start(), running);
  await Promise.resolve();
  assert.equal(count, 1);
  assert.equal(callback, undefined);
  gate.resolve();
  await running;
  assert.equal(tasks.length, 1);
  assert.equal(delay, 1000);
  callback!();
  await tasks[1];
  assert.equal(count, 2);
  controller.abort();
  assert.equal(cancelled, true);
  callback!();
  await Promise.resolve();
  assert.equal(count, 2);
});

test('a producer spanning midnight schedules the new day immediately after settlement', async () => {
  let now = new Date('2026-09-22T16:59:59Z');
  let delay = 0;
  const controller = new AbortController();
  const schedule = createDailyDigestSchedule({
    signal: controller.signal,
    track: () => {},
    onError: () => assert.fail('unexpected'),
    run: () => {
      now = new Date('2026-09-22T17:00:01Z');
      return Promise.resolve();
    },
    clock: {
      now: () => now,
      schedule: (_fn, ms) => {
        delay = ms;
        return 1;
      },
      cancel: () => {},
    },
  });
  await schedule.start();
  assert.equal(delay, 1);
  controller.abort();
});
