import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { Type } from 'typebox';
import {
  ForbiddenError,
  UnauthenticatedError,
  UnsafeUploadError,
  StaleVersionError,
} from '@rai/shared/errors';
import type { ReadinessReport } from '@rai/shared/schemas/observability';
import { createFixtureIdentityProvider } from '../identity/fixture.js';
import type { IdentityDeps } from '../app.js';
import { buildApp } from '../app.js';
import type { Db } from '../db/client.js';
import { computeReadiness } from './health.js';
import { createStoreProbes } from './probes.js';

const canary = 'RAI-DESK-SYNTHETIC-FIXTURE';
const id = '11111111-1111-4111-8111-111111111111';
function setup(identity?: IdentityDeps, readiness?: () => Promise<ReadinessReport>) {
  let text = '';
  const logStream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      text += chunk.toString();
      done();
    },
  });
  const app = buildApp({
    config: {
      nodeEnv: 'test',
      log: { level: 'info', pretty: false },
      trustProxy: false,
      publicBaseUrl: new URL('http://127.0.0.1:18788'),
    },
    logStream,
    ...(identity === undefined ? {} : { identity }),
    observability: {
      db: {} as Db,
      readiness:
        readiness ??
        (() =>
          computeReadiness(
            {
              identity: () => ({ mode: 'fixture', ready: true }),
              loopbackBind: true,
              mailKind: 'memory',
              qcKind: 'substitute',
              build: { commit: 'dev', schemaVersion: 'unknown' },
            },
            {
              ...createStoreProbes(
                'postgres://synthetic:synthetic@127.0.0.1:1/rai',
                '/nonexistent-synthetic-blob',
              ),
              mailSink: () => Promise.resolve('ok'),
              qc: () => Promise.resolve('disabled'),
            },
          )),
    },
  });
  return {
    ...app,
    text: () => text,
    clear: () => {
      text = '';
    },
    lines: () =>
      text
        .split('\n')
        .filter(Boolean)
        .map(
          (line) =>
            JSON.parse(line) as { event: string; correlationId: string; fields: Record<string, unknown> },
        ),
  };
}
test('actual HTTP error handler captures once, preserves response correlation, and excludes request canaries', async () => {
  const app = setup();
  const errors = [
    new UnauthenticatedError(),
    new ForbiddenError(),
    new UnsafeUploadError('filename_invalid', { filename: canary }),
    new StaleVersionError({
      reason: 'revision_changed',
      guidanceKey: 'error.stale_version.guidance.revision_changed',
      current: { versionId: id, versionNumber: 1, revision: 2, state: 'draft', ready: false },
      refreshPath: '/cases/synthetic',
    }),
    new Error(canary),
  ];
  errors.forEach((error, index) =>
    app.fastify.get(`/test/${index}/:id`, { config: { auth: { kind: 'public' } } }, () => {
      throw error;
    }),
  );
  app.fastify.post(
    '/test/validation',
    {
      config: { auth: { kind: 'public' } },
      schema: { body: Type.Object({ known: Type.String() }, { additionalProperties: false }) },
    },
    () => ({}),
  );
  try {
    const statuses = [401, 403, 422, 409, 500];
    for (let index = 0; index < errors.length; index++) {
      app.clear();
      const response = await app.fastify.inject({
        url: `/test/${index}/${canary}?secret=${canary}`,
        headers: {
          'x-correlation-id': canary,
          authorization: `Bearer ${canary}`,
          cookie: `session=${canary}`,
        },
      });
      assert.equal(response.statusCode, statuses[index]);
      const correlation = response.headers['x-correlation-id'];
      assert.notEqual(correlation, canary);
      assert.equal(response.json<{ error: { correlationId: string } }>().error.correlationId, correlation);
      const lines = app.lines();
      assert.equal(lines.filter((line) => line.event === 'error.captured').length, 1);
      assert.equal(lines.filter((line) => line.event === 'request.completed').length, 1);
      assert.ok(lines.every((line) => line.correlationId === correlation));
      assert.equal(app.text().includes(canary), false);
      assert.equal(app.text().includes('"hostname"'), false);
      if (index === 4) {
        assert.match(String(lines[0]!.fields.stackHash), /^[0-9a-f]{64}$/);
        assert.ok(Array.isArray(lines[0]!.fields.stack));
      }
    }
    for (const payload of [{ known: 'safe', [canary]: canary }, '{broken-json']) {
      app.clear();
      const response = await app.fastify.inject({
        method: 'POST',
        url: '/test/validation',
        headers: { 'content-type': 'application/json' },
        payload,
      });
      assert.equal(response.statusCode, 422);
      assert.deepEqual(app.lines().find((line) => line.event === 'error.captured')!.fields.fieldPaths, [
        'body',
      ]);
      assert.equal(app.text().includes(canary), false);
      assert.equal(app.text().includes('"hostname"'), false);
    }
    app.clear();
    assert.equal((await app.fastify.inject(`/missing/${canary}`)).statusCode, 404);
    assert.equal(app.lines().filter((line) => line.event === 'error.captured').length, 1);
    assert.equal(app.text().includes(canary), false);
    assert.equal(app.text().includes('"hostname"'), false);
  } finally {
    await app.fastify.close();
  }
});
test('healthz is silent during actual connection refusal; readyz503 exposes bounded statuses only', async () => {
  const app = setup();
  try {
    assert.equal((await app.fastify.inject('/healthz')).statusCode, 200);
    assert.equal(app.text(), '');
    const response = await app.fastify.inject('/readyz');
    assert.equal(response.statusCode, 503);
    assert.equal(response.json<{ store: { db: string } }>().store.db, 'unreachable');
    for (const value of [
      'postgres://',
      'synthetic:synthetic',
      '/nonexistent-synthetic-blob',
      'ECONNREFUSED',
    ]) {
      assert.equal(response.body.includes(value), false);
      assert.equal(app.text().includes(value), false);
    }
  } finally {
    await app.fastify.close();
  }
});

test('successful static routes are silent while errors retain request traces', async () => {
  const app = setup();
  app.fastify.get(
    '/static-test',
    { config: { auth: { kind: 'public' }, observability: { staticAsset: true } } },
    () => 'asset',
  );
  try {
    assert.equal((await app.fastify.inject('/static-test')).statusCode, 200);
    assert.equal(app.text(), '');
    assert.equal((await app.fastify.inject('/missing')).statusCode, 404);
    const completed = app.lines().find((line) => line.event === 'request.completed')!;
    assert.equal(completed.fields.errorCode, 'not_found');
  } finally {
    await app.fastify.close();
  }
});

test('health probes bypass a failing cookie session lookup while protected routes still resolve it', async () => {
  let calls = 0;
  const unavailable = (): Promise<never> => Promise.reject(new Error(canary));
  const app = setup({
    fixtureProvider: createFixtureIdentityProvider([]),
    adapter: {
      mode: 'fixture',
      verifier: undefined,
      start: async () => {},
      verifyBoundAddress: () => {},
      resolvePrincipal: unavailable,
      health: () => ({ mode: 'fixture', ready: true }),
      sessionPolicy: () => ({ absoluteHours: 12, idleMinutes: 30 }),
    },
    sessionStore: {
      create: unavailable,
      revoke: unavailable,
      setLocale: unavailable,
      recordSignInRefused: unavailable,
      resolve: async () => {
        calls++;
        return unavailable();
      },
    },
    facts: { byCaseId: unavailable, byArtifactId: unavailable },
  });
  try {
    const headers = { cookie: `rai_session=${canary}` };
    assert.equal((await app.fastify.inject({ url: '/healthz', headers })).statusCode, 200);
    assert.equal(app.text(), '');
    assert.equal((await app.fastify.inject({ url: '/readyz', headers })).statusCode, 503);
    assert.equal(calls, 0);
    assert.equal(app.lines().filter((line) => line.event === 'error.captured').length, 0);
    assert.equal((await app.fastify.inject({ url: '/api/operator/desk-health', headers })).statusCode, 500);
    assert.equal(calls, 1);
    assert.equal(app.text().includes(canary), false);
  } finally {
    await app.fastify.close();
  }
});

test('readiness emits its first status and transitions, not repeated polls', async () => {
  let db: 'ok' | 'unreachable' = 'ok';
  const app = setup(undefined, () =>
    computeReadiness(
      {
        identity: () => ({ mode: 'fixture', ready: true }),
        loopbackBind: true,
        mailKind: 'memory',
        qcKind: 'substitute',
        build: { commit: 'dev', schemaVersion: 'unknown' },
      },
      {
        db: () => Promise.resolve(db),
        migrations: () => Promise.resolve('current'),
        blob: () => Promise.resolve('ok'),
        mailSink: () => Promise.resolve('ok'),
        qc: () => Promise.resolve('disabled'),
      },
    ),
  );
  try {
    for (const status of ['ok', 'ok', 'unreachable', 'unreachable', 'ok'] as const) {
      db = status;
      assert.equal((await app.fastify.inject('/readyz')).statusCode, db === 'ok' ? 200 : 503);
    }
    const events = app.lines().filter((line) => line.event === 'health.readiness');
    assert.deepEqual(
      events.map((line) => line.fields.status),
      ['ready', 'not_ready', 'ready'],
    );
  } finally {
    await app.fastify.close();
  }
});
