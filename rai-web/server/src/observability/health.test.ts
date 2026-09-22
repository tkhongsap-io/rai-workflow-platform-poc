import test from 'node:test';
import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import { ReadinessReportSchema } from '@rai/shared/schemas/observability';
import {
  computeReadiness,
  createReadinessReader,
  type HealthProbes,
  type ReadinessConfig,
} from './health.js';

const config: ReadinessConfig = {
  identity: () => ({ mode: 'local-google', ready: true }),
  loopbackBind: true,
  mailKind: 'memory',
  qcKind: 'substitute',
  build: { commit: 'dev', schemaVersion: '7' },
};
const probes: HealthProbes = {
  db: () => Promise.resolve('ok'),
  migrations: () => Promise.resolve('current'),
  blob: () => Promise.resolve('ok'),
  mailSink: () => Promise.resolve('ok'),
  qc: () => Promise.resolve('unavailable'),
};
test('OBS-01 readiness gates each store/mail dependency but not QC', async () => {
  assert.equal((await computeReadiness(config, probes)).status, 'ready');
  for (const changed of [
    { db: () => Promise.resolve('unreachable' as const) },
    { migrations: () => Promise.resolve('pending' as const) },
    { blob: () => Promise.resolve('not_writable' as const) },
    { mailSink: () => Promise.resolve('unavailable' as const) },
  ]) {
    assert.equal((await computeReadiness(config, { ...probes, ...changed })).status, 'not_ready');
  }
  for (const reason of [
    'mode_unknown',
    'bind_not_loopback',
    'base_url_not_loopback',
    'base_url_not_https',
    'proxy_forbidden_in_mode',
    'network_source_unknown',
    'allow_list_invalid',
    'google_forbidden_in_mode',
    'issuer_not_entra',
    'group_mapping_missing',
    'fixture_outside_test',
    'discovery_failed',
    'secret_missing:RAI_IDENTITY_GOOGLE_CLIENT_ID',
    'secret_missing:RAI_IDENTITY_GOOGLE_CLIENT_SECRET',
    'secret_missing:RAI_IDENTITY_OIDC_ISSUER_URL',
    'secret_missing:RAI_IDENTITY_OIDC_CLIENT_ID',
    'secret_missing:RAI_IDENTITY_OIDC_CLIENT_SECRET',
    'secret_missing:RAI_IDENTITY_ALLOW_LIST_JSON',
    'secret_missing:RAI_IDENTITY_ENTRA_TENANT_ID',
    'secret_missing:RAI_SESSION_ABSOLUTE_HOURS',
  ] as const) {
    const report = await computeReadiness(
      { ...config, identity: () => ({ mode: 'unset', ready: false, reason }) },
      probes,
    );
    assert.equal(report.status, 'not_ready');
    assert.equal(report.identity.reason, reason);
    assert.equal(Value.Check(ReadinessReportSchema, report), true);
  }
});
test('OBS-05 throws, arbitrary reason text and hung probes remain bounded and safe', async () => {
  const canary = 'postgres://private-secret@internal-host';
  const report = await computeReadiness(
    {
      ...config,
      identity: () => ({ mode: 'unset', ready: false, reason: `secret_missing:${canary}` }),
      build: { commit: canary, schemaVersion: canary },
    },
    {
      ...probes,
      db: () => new Promise(() => {}),
      migrations: () => Promise.reject(new Error(canary)),
      blob: () => Promise.reject(new Error(canary)),
    },
    { timeoutMs: 10 },
  );
  assert.equal(report.store.db, 'timeout');
  assert.equal(report.store.migrations, 'unknown');
  assert.equal(report.status, 'not_ready');
  assert.equal(JSON.stringify(report).includes(canary), false);
  assert.equal(Value.Check(ReadinessReportSchema, report), true);
});
test('readiness cache coalesces concurrent requests, expires, and isolates caller mutations', async () => {
  let calls = 0;
  let now = 0;
  const read = createReadinessReader(
    async () => {
      calls++;
      return computeReadiness(config, probes);
    },
    () => now,
  );
  const reports = await Promise.all(Array.from({ length: 20 }, () => read()));
  assert.equal(calls, 1);
  reports[0]!.status = 'not_ready';
  assert.equal((await read()).status, 'ready');
  now = 5000;
  await read();
  assert.equal(calls, 2);
});
