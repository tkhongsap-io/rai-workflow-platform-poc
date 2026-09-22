import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import Fastify from 'fastify';
import { createDrain } from '../shutdown.js';
import type { Emitter } from '../observability/log.js';
import { registerNotifications } from './runtime.js';

for (const mode of ['request', 'request-stalled', 'poll', 'poll-stalled']) {
  const polled = mode.startsWith('poll');
  const stalled = mode.endsWith('stalled');
  test(`${polled ? 'polled' : 'post-response'} shutdown: ${stalled ? 'deadline rejects without abandoning delivery' : 'settled work drains'}`, async () => {
    const app = Fastify();
    const drain = createDrain(app);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let calls = 0;
    let active = false;
    let cancelled = false;
    registerNotifications(
      app,
      {
        deliverInitial: () => Promise.resolve(undefined),
        deliverPending: async (correlation, signal) => {
          calls += 1;
          if (!correlation && (!polled || calls === 1)) return;
          active = true;
          entered.resolve();
          try {
            await release.promise;
            signal?.throwIfAborted();
          } catch {
            cancelled = true;
          } finally {
            active = false;
          }
        },
      },
      { log: () => {} } as unknown as Emitter,
      drain,
    );
    app.route({ method: ['GET', 'POST'], url: '/', handler: () => Promise.resolve({ ok: true }) });
    await app.listen({ host: '127.0.0.1', port: 0 });
    try {
      const address = app.server.address();
      assert.ok(address && typeof address !== 'string');
      const response = await fetch(`http://127.0.0.1:${address.port}/`, {
        method: polled ? 'GET' : 'POST',
      });
      assert.equal(response.status, 200);
      await response.text();
      await entered.promise;
      await delay(0);
      assert.equal(drain.inFlight(), 0);
      const before = performance.now();
      const closing = drain.close(stalled ? 10 : 1000);
      assert.equal(drain.signal.aborted, true);
      if (stalled) {
        await assert.rejects(closing, /shutdown_background_deadline/);
        assert.ok(performance.now() - before < 500);
        assert.equal(active, true);
        assert.equal(cancelled, false);
        release.resolve();
      } else {
        release.resolve();
        await closing;
      }
      await app.close();
      assert.equal(active, false);
      assert.equal(cancelled, true);
      const stoppedAt = calls;
      await delay(300);
      assert.equal(calls, stoppedAt, 'closed runtime must not poll again');
    } finally {
      release.resolve();
      await app.close();
    }
  });
}
