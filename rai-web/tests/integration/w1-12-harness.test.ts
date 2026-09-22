// W1-12: the integration harness proves itself (W0-02 section 8.1). The spawned test server is the one
// deployable in test mode on loopback with the fixture identity provider, the in-memory mail sink and the QC
// substitute; no Google, no mail transport, no network beyond 127.0.0.1. Fixture ids: none (no route exists yet
// beyond the W1-00 error envelope; W1-01a brings the first).

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../support/observed-app.js';
import type { App } from '@rai/server/app';
import { parseConfig } from '@rai/server/config';
import {
  startTestServer,
  testServerEnv,
  freeLoopbackPort,
  type TestServerProcess,
} from '../support/process.js';
import { FixtureSignInError, asUser, firstCookie, signInAsFixture } from '../support/sign-in.js';

describe('W1-12 test-server process with log capture', () => {
  let server: TestServerProcess;

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    await server.stop();
  });

  it('starts in fixture mode on loopback and logs process.started with the W0-10 fields', () => {
    const started = server.linesFor('process.started');
    assert.equal(started.length, 1);
    const fields = started[0]?.fields as Record<string, unknown>;
    assert.equal(fields.identityMode, 'fixture');
    assert.equal(fields.loopback, true);
    assert.equal(started[0]?.stream, 'stdout');
    assert.equal(typeof started[0]?.processId, 'string');
    assert.equal(started[0]?.correlationId, null); // process-level line (W0-10 section 3.2)
  });

  it('answers an unknown API path with the W0-06 envelope, a correlation id and no-store', async () => {
    const response = await fetch(`${server.baseUrl}/api/w1-12-harness-probe`);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const correlationId = response.headers.get('x-correlation-id');
    assert.ok(correlationId !== null && correlationId.length > 0);
    const body = (await response.json()) as {
      error: { code: string; messageKey: string; correlationId: string };
    };
    assert.equal(body.error.code, 'not_found');
    assert.equal(body.error.messageKey, 'error.not_found');
    assert.equal(body.error.correlationId, correlationId);
  });

  it('carries the test-mode variables and never a Google client or a mail transport', () => {
    const env = testServerEnv(server.port);
    assert.equal(env.NODE_ENV, 'test');
    assert.equal(env.RAI_IDENTITY_MODE, 'fixture');
    assert.equal(env.HOST, '127.0.0.1');
    assert.equal(env.MAIL_MODE, 'sink-memory');
    assert.equal(env.QC_MODE, 'substitute');
    assert.equal(env.LOG_PRETTY, 'false');
    assert.equal(env.PUBLIC_BASE_URL, `http://127.0.0.1:${server.port}`);
    const config = parseConfig(env);
    assert.equal(config.identity.mode, 'fixture');
    assert.equal(config.mail.mode, 'sink-memory');
    assert.equal(config.qc.mode, 'substitute');
  });

  it('stops on SIGTERM with process.stopping and exit code 0', async () => {
    const exit = await server.stop();
    assert.deepEqual(exit, { code: 0, signal: null });
    const stopping = server.linesFor('process.stopping');
    assert.equal(stopping.length, 1);
    assert.deepEqual(stopping[0]?.fields, { signal: 'SIGTERM' });
  });
});

describe('W1-12 test-server refusal is reported, not hidden', () => {
  it('rejects with the process.refused line when the configuration fails closed (fixture on a non-loopback bind)', async () => {
    await assert.rejects(
      startTestServer({ env: { HOST: '0.0.0.0' } }),
      (err: Error) => err.message.includes('process.refused') && err.message.includes('bind_not_loopback'),
    );
  });

  it('waitForEvent times out with the captured lines in the message instead of hanging', async () => {
    const server = await startTestServer();
    try {
      await assert.rejects(
        server.waitForEvent('mail.sent', 50),
        (err: Error) =>
          err.message.startsWith('no mail.sent line within 50 ms') && err.message.includes('process.started'),
      );
    } finally {
      await server.stop();
    }
  });

  it('freeLoopbackPort hands out a usable port', async () => {
    const port = await freeLoopbackPort();
    assert.ok(port > 0 && port < 65536);
  });
});

describe('W1-12 fixture sign-in helper (inject)', () => {
  let app: App;

  before(async () => {
    const env = testServerEnv(8790);
    app = buildApp({ config: parseConfig(env) });
    await app.fastify.ready();
  });

  after(async () => {
    await app.fastify.close();
  });

  it('fails loudly while the W1-01a route is absent instead of fabricating a session', async () => {
    await assert.rejects(
      signInAsFixture(app.fastify, 'fx-user-owner-cm'),
      (err: unknown) =>
        err instanceof FixtureSignInError &&
        err.status === 404 &&
        err.fixtureUserId === 'fx-user-owner-cm' &&
        err.message.includes('/auth/fixture/sign-in'),
    );
  });

  it('reduces a Set-Cookie header to name=value and sends it with same-origin fetch metadata', () => {
    assert.equal(firstCookie('rai_session=abc123; Path=/; HttpOnly; SameSite=Lax'), 'rai_session=abc123');
    assert.equal(firstCookie(['rai_session=abc123; Path=/', 'other=x']), 'rai_session=abc123');
    assert.equal(firstCookie(undefined), undefined);
    assert.equal(firstCookie(''), undefined);
    const headers = asUser({ cookie: 'rai_session=abc123' });
    assert.deepEqual(headers, { cookie: 'rai_session=abc123', 'sec-fetch-site': 'same-origin' });
  });
});
