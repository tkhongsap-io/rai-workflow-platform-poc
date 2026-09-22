// A producer clock only; never dispatches mail or retries. Bind to the shared drain at composition root.
import type { FastifyInstance } from 'fastify';
import type { Drain } from '../shutdown.js';
import { createDigestProducer, type DigestDeps } from './digest.js';
import { bangkokDate } from '@rai/shared/sla/working-days';

export function untilNextBangkokDay(now: Date): number {
  const midnight = new Date(`${bangkokDate(now)}T00:00:00+07:00`).getTime();
  return Math.max(1, midnight + 86_400_000 - now.getTime());
}
export interface DigestClock {
  now(): Date;
  schedule(fn: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}
const systemClock: DigestClock = {
  now: () => new Date(),
  schedule: (fn, ms) => {
    const timer = setTimeout(fn, ms);
    timer.unref();
    return timer;
  },
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
export function createDailyDigestSchedule(options: {
  run: (signal: AbortSignal) => Promise<unknown>;
  track: (task: Promise<void>) => void;
  onError: (error: unknown) => void;
  signal: AbortSignal;
  clock?: DigestClock;
}) {
  const clock = options.clock ?? systemClock;
  let timer: unknown;
  let started = false;
  let active: Promise<void> | undefined;
  function tick(): Promise<void> {
    if (options.signal.aborted) return Promise.resolve();
    if (active) return active;
    const startedDay = bangkokDate(clock.now());
    const task = Promise.resolve()
      .then(() => {
        options.signal.throwIfAborted();
        return options.run(options.signal);
      })
      .then(
        () => {},
        (error: unknown) => {
          if (!options.signal.aborted) options.onError(error);
        },
      );
    active = task;
    options.track(task);
    void task.then(() => {
      active = undefined;
      if (!options.signal.aborted)
        timer = clock.schedule(
          () => {
            void tick();
          },
          bangkokDate(clock.now()) === startedDay ? untilNextBangkokDay(clock.now()) : 1,
        );
    });
    return task;
  }
  options.signal.addEventListener(
    'abort',
    () => {
      if (timer !== undefined) clock.cancel(timer);
    },
    { once: true },
  );
  return {
    start(): Promise<void> {
      if (started) return active ?? Promise.resolve();
      started = true;
      return tick();
    },
  };
}

/** Startup producer runs before the existing dispatcher hook. No sink/retry loop here. */
export function registerDailyDigest(
  app: FastifyInstance,
  deps: DigestDeps,
  drain: Drain,
  onError: (error: unknown) => void,
): void {
  const stopping = new AbortController();
  const active = new Set<Promise<void>>();
  const schedule = createDailyDigestSchedule({
    run: createDigestProducer(deps),
    signal: AbortSignal.any([drain.signal, stopping.signal]),
    track: (task) => {
      active.add(task);
      drain.track(task);
      void task.finally(() => active.delete(task));
    },
    onError,
  });
  app.addHook('onReady', () => schedule.start());
  app.addHook('onClose', async () => {
    stopping.abort();
    await Promise.all(active);
  });
}
