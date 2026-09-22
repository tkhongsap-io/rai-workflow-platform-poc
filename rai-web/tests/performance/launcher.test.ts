import { parseConfig, UPLOAD_LIMIT_DEFAULTS } from '../../server/src/config.js';
import { serverEnv } from './server-env.js';
import { FIXTURE_USERS } from '@rai/fixtures/data/users';
import { createStaticSubjectDirectory } from '../../server/src/cases/subject-directory.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { QcRunRequest } from '@rai/shared/qc/types';
import { scenario } from './qc-scenario.js';
import {
  expectedCase,
  proveCase,
  guardLaunch,
  validCommand,
  ENGINE,
  SCENARIO,
  type LaunchConfig,
} from './server-contract.js';
import { settlement, poll } from './settlement.js';
import type { RunConfig } from './core.js';
const target = (name: string, port: number): RunConfig => ({
  baseUrl: `http://127.0.0.1:${port}`,
  target: { host: '127.0.0.1', port: 54370, database: `rai_perf_${name}` },
  urls: Object.fromEntries(
    ['app', 'owner', 'operator'].map((role) => [
      role,
      `postgresql://rai_${role}:synthetic@127.0.0.1:54370/rai_perf_${name}`,
    ]),
  ) as RunConfig['urls'],
  finalHead: 'a'.repeat(40),
  authorization: 'parent-authorized-final-head',
});
const mutationCase = {
  source_record_id: 'TPM-SYNTHETIC-PERF-MUT-0',
  use_case_name: 'SYNTHETIC-PERF-MUT-0',
  owner_subject_id: 'fixture:fx-user-owner-cm',
  business_owner: 'ณัฐพร ส. (Nattaporn S.)',
  created_by: 'fixture:fx-user-owner-cm',
  business_unit: 'CM',
  business_unit_id: 'CM',
  technical_owner: 'Synthetic performance owner',
  vendor_involved: false as const,
  model_type: 'llm' as const,
  maxVersion: 2,
};
const config: LaunchConfig = {
  queue: target('queue', 8901),
  mutation: target('mutation', 8902),
  target: 'queue',
  fixtureSha256: 'a'.repeat(64),
  serverRoot: '/tmp/final/rai-web',
  resourceRoot: '/tmp/rai-perf-unit',
  scenario: SCENARIO,
  mutationCases: [mutationCase],
};
test('launch guard rejects cross-role routing, shared DB/origin, foreign port and unbounded mutation recipes', () => {
  guardLaunch(config);
  for (const mutate of [
    (c: LaunchConfig) => {
      c.fixtureSha256 = 'unverified';
    },
    (c: LaunchConfig) => {
      c.queue.target.port = 54369;
    },
    (c: LaunchConfig) => {
      c.mutation = { ...c.queue, baseUrl: c.mutation.baseUrl };
    },
    (c: LaunchConfig) => {
      c.mutation.baseUrl = c.queue.baseUrl;
    },
    (c: LaunchConfig) => {
      c.queue.urls.operator = c.mutation.urls.operator;
    },
    (c: LaunchConfig) => {
      c.mutationCases = Array.from({ length: 65 }, () => mutationCase);
    },
    (c: LaunchConfig) => {
      c.mutationCases[0]!.created_by = 'fixture:fx-user-admin';
    },
  ]) {
    const c = structuredClone(config);
    mutate(c);
    assert.throws(() => guardLaunch(c));
  }
  assert.throws(() => expectedCase(config, 995));
  assert.throws(() => expectedCase({ ...config, target: 'mutation' }, 1));
});
test('enrollment requires exact real-seed fields and one-to-one recipe binding; runner remains narrow', async () => {
  const expected = expectedCase(config, 0),
    id = randomUUID();
  assert.equal(expected.source_record_id, 'TPM-SYNTHETIC-PERF-0');
  for (const key of Object.keys(expected).filter((k) => k !== 'maxVersion'))
    assert.throws(() => proveCase(expected, { ...expected, [key]: 'forged' }));
  const control = scenario(config, () => Promise.resolve([{ ...expected }]));
  const req = {
    trigger: 'submit',
    lane: null,
    modelType: 'llm',
    vendorInvolved: false,
    version: { caseId: id, versionId: randomUUID(), versionNumber: 1, isDraft: false },
  } as QcRunRequest;
  const signal = new AbortController().signal;
  assert.equal((await control.runner.run(req, signal)).status, 'unavailable');
  await control.enroll(0, id);
  assert.equal((await control.runner.run(req, signal)).status, 'completed');
  assert.deepEqual(((await control.runner.run(req, signal)) as { findings: unknown[] }).findings, []);
  assert.equal((await control.runner.run({ ...req, trigger: 'upload' }, signal)).status, 'unavailable');
  assert.equal(
    (await control.runner.run({ ...req, version: { ...req.version, versionNumber: 2 } }, signal)).status,
    'unavailable',
  );
  await assert.rejects(control.enroll(0, randomUUID()));
  await assert.rejects(control.enroll(1, id));
  assert.equal(await control.runner.probe(), 'ok');
  const aborted = new AbortController();
  aborted.abort();
  assert.throws(() => control.runner.run(req, aborted.signal));
  control.close();
  assert.equal(await control.runner.probe(), 'unavailable');
  assert.equal((await control.runner.run(req, signal)).status, 'unavailable');
});
test('racing enrollments cannot steal one recipe', async () => {
  const gate = Promise.withResolvers<void>(),
    expected = expectedCase(config, 0);
  const control = scenario(config, async () => {
    await gate.promise;
    return [{ ...expected }];
  });
  const first = control.enroll(0, randomUUID()),
    second = control.enroll(0, randomUUID());
  gate.resolve();
  const result = await Promise.allSettled([first, second]);
  assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(control.ids().length, 1);
});
test('IPC accepts only bounded enrollment/settlement commands, not faults or arbitrary SQL', () => {
  const id = randomUUID();
  assert(validCommand({ id, op: 'settled' }));
  assert(validCommand({ id, op: 'enroll', key: 0, caseId: randomUUID() }));
  for (const bad of [
    null,
    {},
    { id, op: 'sql', text: 'SELECT 1' },
    { id, op: 'settled', reset: true },
    { id, op: 'submit' },
  ])
    assert.equal(validCommand(bad), false);
});
test('settlement requires committed clean QC plus original audit/correlation and successful lane notices', async () => {
  const caseId = randomUUID(),
    versionId = randomUUID(),
    correlationId = randomUUID();
  let status = 'completed';
  const control = settlement(
    (sql) =>
      Promise.resolve(
        sql.includes('audit_event')
          ? [{ id: randomUUID() }]
          : sql.includes('FROM qc_run')
            ? [{ status, engine_id: ENGINE, correlation_id: correlationId, findings: 0 }]
            : ['ai_coe', 'dpo', 'it_security'].map((lane) => ({ lane, status: 'sent' })),
      ),
    () => [caseId],
  );
  await control.submit({ caseId, versionId, correlationId });
  status = 'unavailable';
  await assert.rejects(control.submit({ caseId, versionId, correlationId }));
  await assert.rejects(
    poll(() => Promise.resolve(false), 1),
    /settlement deadline/,
  );
});

test('complete launcher environment passes real config parser with bounded limits for both targets', () => {
  for (const target of ['queue', 'mutation'] as const) {
    const launch = { ...config, target };
    const env = serverEnv(launch, '/tmp/rai-perf-test');
    const parsed = parseConfig(env);
    assert.equal(parsed.nodeEnv, 'test');
    assert.equal(parsed.identity.mode, 'fixture');
    assert.equal(parsed.publicBaseUrl.origin, launch[target].baseUrl);
    assert.deepEqual(parsed.upload, {
      maxFileBytes: UPLOAD_LIMIT_DEFAULTS.UPLOAD_MAX_FILE_BYTES,
      maxPackBytes: UPLOAD_LIMIT_DEFAULTS.UPLOAD_MAX_PACK_BYTES,
      maxImagePixels: UPLOAD_LIMIT_DEFAULTS.UPLOAD_MAX_IMAGE_PIXELS,
    });
    assert.equal(parsed.idempotencyTtlHours, 72);
    assert.equal(parsed.blobOrphanMinAgeHours, 24);
    assert.equal(parsed.blobTmpMaxAgeHours, 1);
    for (const key of [
      'UPLOAD_MAX_FILE_BYTES',
      'UPLOAD_MAX_PACK_BYTES',
      'UPLOAD_MAX_IMAGE_PIXELS',
      'IDEMPOTENCY_TTL_HOURS',
      'BLOB_ORPHAN_MIN_AGE_HOURS',
      'BLOB_TMP_MAX_AGE_HOURS',
    ]) {
      const incomplete = { ...env };
      delete incomplete[key];
      assert.throws(() => parseConfig(incomplete));
    }
  }
});

test('enrollment accepts API-resolved fixture display names and rejects subject text as business_owner', async () => {
  const directory = createStaticSubjectDirectory(FIXTURE_USERS);
  for (const key of [0, 1]) {
    const expected = expectedCase(config, key);
    const resolved = await directory.resolve(expected.owner_subject_id);
    assert(resolved);
    assert.notEqual(resolved.displayName, resolved.subjectId);
    assert.equal(expected.business_owner, resolved.displayName);
    proveCase(expected, { ...expected, business_owner: resolved.displayName });
    assert.throws(() => proveCase(expected, { ...expected, business_owner: resolved.subjectId }));
  }
  guardLaunch({ ...config, target: 'mutation' });
  const wrong = structuredClone(config);
  wrong.mutationCases[0]!.business_owner = wrong.mutationCases[0]!.owner_subject_id;
  assert.throws(() => guardLaunch(wrong));
});

test('successor settlement includes resubmitted audits with exact version/correlation, including aggregate failures', async () => {
  const caseId = randomUUID(),
    versionId = randomUUID(),
    correlationId = randomUUID();
  const proof = { caseId, versionId, correlationId };
  let aggregateGood = true;
  const control = settlement(
    async (sql, values) => {
      await Promise.resolve(); // Preserve the asynchronous query boundary without a DB.
      if (sql.includes('FROM audit_event')) {
        assert(sql.includes("'version.submitted'"));
        assert(sql.includes("'version.resubmitted'"));
        if (sql.includes('GROUP BY')) {
          assert(sql.includes('q.version_id=a.target_version_id'));
          assert(sql.includes('q.correlation_id=a.correlation_id'));
          assert.deepEqual(values, [[caseId], ENGINE]);
          return [{ target_version_id: versionId, runs: 1, good: aggregateGood }];
        }
        assert(sql.includes('target_version_id=$2 AND correlation_id=$3'));
        return JSON.stringify(values) === JSON.stringify([caseId, versionId, correlationId])
          ? [{ id: randomUUID() }]
          : [];
      }
      if (sql.includes('FROM qc_run')) {
        assert.deepEqual(values, [versionId]);
        return [{ status: 'completed', engine_id: ENGINE, correlation_id: correlationId, findings: 0 }];
      }
      if (sql.includes('GROUP BY status')) return [{ status: 'sent', count: 4 }];
      assert.deepEqual(values, [caseId, versionId, correlationId]);
      return ['ai_coe', 'dpo', 'it_security'].map((lane) => ({ lane, status: 'sent' }));
    },
    () => [caseId],
  );
  await control.submit(proof);
  await assert.rejects(
    control.submit({ ...proof, correlationId: randomUUID() }),
    /missing original submission audit/,
  );
  await assert.rejects(
    control.submit({ ...proof, versionId: randomUUID() }),
    /missing original submission audit/,
  );
  await control.settled();
  aggregateGood = false;
  await assert.rejects(control.settled(), /non-clean submit outcome/);
});
