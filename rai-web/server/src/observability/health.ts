import { Value } from 'typebox/value';
import { ReadinessReportSchema, type ReadinessReport } from '@rai/shared/schemas/observability';
import type { IdentityHealth } from '../identity/types.js';

export const PROBE_TIMEOUT_MS = 2_000;
export const READINESS_CACHE_MS = 5_000;
type Store = ReadinessReport['store'];
export interface HealthProbes {
  db(): Promise<Store['db']>;
  migrations(): Promise<Store['migrations']>;
  blob(): Promise<Store['blob']>;
  mailSink(): Promise<ReadinessReport['mailSink']['status']>;
  qc(): Promise<ReadinessReport['qc']['status']>;
}
export interface ReadinessConfig {
  identity(): IdentityHealth;
  loopbackBind: boolean;
  mailKind: ReadinessReport['mailSink']['kind'];
  qcKind: ReadinessReport['qc']['kind'];
  build: ReadinessReport['build'];
}

/** A failed or malformed probe can contribute only an enumerated status, never exception text. */
async function bounded<T extends string>(
  probe: () => Promise<T>,
  allowed: readonly T[],
  failure: T,
  timeout: T,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(probe)
        .then(
          (value) => (allowed.includes(value) ? value : failure),
          () => failure,
        ),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(timeout), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function computeReadiness(
  config: ReadinessConfig,
  probes: HealthProbes,
  options: { now?: () => Date; timeoutMs?: number } = {},
): Promise<ReadinessReport> {
  const timeout = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const unsetIdentity = {
    mode: 'unset',
    loopbackBind: config.loopbackBind,
    status: 'misconfigured',
    reason: 'mode_unknown',
  } as const;
  let identity: ReadinessReport['identity'];
  try {
    const health = config.identity();
    const candidate = {
      mode: health.mode,
      loopbackBind: config.loopbackBind,
      status: health.ready ? ('ok' as const) : ('misconfigured' as const),
      ...(health.reason === undefined ? {} : { reason: health.reason }),
    };
    identity = Value.Check(ReadinessReportSchema.properties.identity, candidate) ? candidate : unsetIdentity;
  } catch {
    identity = unsetIdentity;
  }
  const [db, migrations, blob, mail, qc] = await Promise.all([
    bounded(() => probes.db(), ['ok', 'unreachable', 'timeout'], 'unreachable', 'timeout', timeout),
    bounded(
      () => probes.migrations(),
      ['current', 'pending', 'ahead', 'unknown'],
      'unknown',
      'unknown',
      timeout,
    ),
    bounded(
      () => probes.blob(),
      ['ok', 'unreachable', 'not_writable'],
      'unreachable',
      'unreachable',
      timeout,
    ),
    bounded(() => probes.mailSink(), ['ok', 'unavailable'], 'unavailable', 'unavailable', timeout),
    bounded(() => probes.qc(), ['ok', 'unavailable', 'disabled'], 'unavailable', 'unavailable', timeout),
  ]);
  return {
    status:
      // W7-03: `ahead` (every newer applied migration is additive) serves, as W0-04 "Schema evolution" requires.
      identity.status === 'ok' &&
      db === 'ok' &&
      (migrations === 'current' || migrations === 'ahead') &&
      blob === 'ok' &&
      mail === 'ok'
        ? 'ready'
        : 'not_ready',
    checkedAt: (options.now?.() ?? new Date()).toISOString(),
    identity,
    store: { db, migrations, blob },
    mailSink: { kind: config.mailKind, status: mail },
    qc: { kind: config.qcKind, status: qc },
    build: {
      commit: /^(dev|[0-9a-f]{7,40})$/.test(config.build.commit) ? config.build.commit : 'dev',
      schemaVersion: /^(unknown|[0-9]+)$/.test(config.build.schemaVersion)
        ? config.build.schemaVersion
        : 'unknown',
    },
  };
}

/** Share in-flight work as well as completed reports; a polling burst must not multiply DB probes. */
export function createReadinessReader(
  compute: () => Promise<ReadinessReport>,
  now: () => number = Date.now,
): () => Promise<ReadinessReport> {
  let cached: ReadinessReport | undefined;
  let expires = 0;
  let inFlight: Promise<ReadinessReport> | undefined;
  return async () => {
    if (cached !== undefined && now() < expires) return structuredClone(cached);
    inFlight ??= compute()
      .then((report) => {
        cached = structuredClone(report);
        expires = now() + READINESS_CACHE_MS;
        return cached;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return structuredClone(await inFlight);
  };
}
