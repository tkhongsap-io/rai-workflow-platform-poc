// A producer clock only; never dispatches mail or retries. Bind to the shared drain at composition root.
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
  onError: () => void;
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
        () => {
          if (!options.signal.aborted) options.onError();
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
