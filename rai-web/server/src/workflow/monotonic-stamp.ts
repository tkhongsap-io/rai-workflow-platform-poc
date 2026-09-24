// Process-wide monotonic stamp for QC run requests. A frozen injected clock still orders successive
// inserts: if `now()` is ≤ the last stamp this process issued, advance by 1 ms.
let lastMs = Number.NEGATIVE_INFINITY;

export function nextMonotonicStamp(now: () => Date = () => new Date()): Date {
  const candidate = now().getTime();
  const ms = candidate <= lastMs ? lastMs + 1 : candidate;
  lastMs = ms;
  return new Date(ms);
}
