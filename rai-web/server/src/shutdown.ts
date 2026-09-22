// W0-04 graceful shutdown ("on SIGTERM the server stops accepting connections, waits up to 10 s for in-flight
// transactions, then exits"; docs/engineering/performance-targets.md "Graceful shutdown", 10 s, main.ts).
//
// Why this exists: `fastify.close()` calls `http.Server.close()`, whose idle sweep closes only the sockets Node's
// HTTP parser has seen a request on. A socket that connected and sent nothing — Chromium's speculative
// pre-connect, which every open tab holds — is never swept, so `close()` waits for it forever and the deployable
// hangs after SIGTERM whenever a browser tab is open (found by the W1-INT review on the CI runner; reproduced with
// a plain `net.connect` that writes nothing). The drain here: initiate the close (no new connections are
// accepted, Node's sweep runs), wait until every request the app has accepted has answered — bounded by
// `drainMs` — then destroy every remaining socket (0-byte pre-connects, keep-alive sockets that went idle after
// the sweep, and any request past the deadline, whose transaction Postgres rolls back) so the close completes.
// In-flight requests are counted at `onRequest` and released on the raw response's `close` event, which fires
// both when the response finished and when the client cut the connection.

import type { FastifyInstance } from 'fastify';

/** The W0-04 budget: in-flight requests get this long after SIGTERM before their sockets are destroyed. */
export const SHUTDOWN_DRAIN_MS = 10_000;

export interface Drain {
  /** Requests accepted and not yet answered (or abandoned by the client). */
  inFlight(): number;
  /** Abort new/background work when shutdown begins; active sinks must settle before rollback. */
  readonly signal: AbortSignal;
  track(task: Promise<void>): void;
  /** Closes the app: initiate, wait for in-flight requests up to `drainMs`, destroy what is left, complete. */
  close(drainMs?: number): Promise<void>;
}

/** Installs the in-flight counter on `fastify` (before listen) and returns the bounded close. */
export function createDrain(fastify: FastifyInstance): Drain {
  let inFlight = 0;
  const controller = new AbortController();
  const background = new Set<Promise<void>>();
  const idleWaiters = new Set<() => void>();
  fastify.addHook('onRequest', (_request, reply, done) => {
    inFlight += 1;
    reply.raw.once('close', () => {
      inFlight -= 1;
      if (inFlight === 0 && background.size === 0) for (const wake of idleWaiters) wake();
    });
    done();
  });

  const untilIdle = (deadlineMs: number) =>
    new Promise<void>((resolve) => {
      if (inFlight === 0 && background.size === 0) {
        resolve();
        return;
      }
      const timer = setTimeout(finish, deadlineMs);
      idleWaiters.add(finish);
      function finish() {
        clearTimeout(timer);
        idleWaiters.delete(finish);
        resolve();
      }
    });

  return {
    inFlight: () => inFlight,
    signal: controller.signal,
    track(task) {
      background.add(task);
      const finished = () => {
        background.delete(task);
        if (inFlight === 0 && background.size === 0) for (const wake of idleWaiters) wake();
      };
      void task.then(finished, finished);
    },
    async close(drainMs = SHUTDOWN_DRAIN_MS) {
      controller.abort();
      const closing = fastify.close(); // stops accepting; Node's idle sweep; the onClose hooks
      void closing.catch(() => {}); // observed even if the deadline rejects first
      await untilIdle(drainMs);
      fastify.server.closeAllConnections(); // whatever the sweep left: 0-byte sockets, late idles, the overdue
      // Never release a transaction while its sink is still active. main.ts handles this
      // rejection with process.exit(1); process termination closes DB connections/rolls back.
      if (background.size !== 0) throw new Error('shutdown_background_deadline');
      await closing;
    },
  };
}
