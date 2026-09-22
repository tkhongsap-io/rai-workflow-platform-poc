// Intentionally failing node:test controls; invoked only by w3-int-log-coverage.test.ts.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { buildApp } from '../observed-app.js';
import { createAuditedLogStream } from '../log-capture.js';
import { FIXTURE_USERS } from '@rai/fixtures/data/users';

const scenario = process.argv[2];
const marker = 'RAI-DESK-SYNTHETIC-FIXTURE';
let forwarded = '';
const stream = new Writable({
  write(chunk: Buffer, _encoding, done) {
    forwarded += chunk.toString();
    done();
  },
});
const config = {
  nodeEnv: 'test' as const,
  log: { level: 'error' as const, pretty: false },
  publicBaseUrl: new URL('http://127.0.0.1:18788'),
  trustProxy: false,
};
const app = buildApp({ config, logStream: stream });
app.fastify.get('/safe', { config: { auth: { kind: 'public' } } }, () => ({ ok: true }));
const leak = (value = marker) => app.fastify.log.info({ probe: value });

test('observed log control', async () => {
  await app.fastify.ready();
  assert.equal(config.log.level, 'error', 'caller configuration must stay unchanged');
  assert.equal(app.fastify.log.level, 'info');
  switch (scenario) {
    case 'safe':
      app.fastify.log.info({ probe: 'safe' });
      assert.ok(forwarded.includes('"probe":"safe"'));
      assert.equal(stream.writableEnded, false);
      assert.equal((await app.fastify.inject('/safe')).statusCode, 200);
      break;
    case 'marker':
      leak();
      break;
    case 'email':
      leak(FIXTURE_USERS[0]!.email);
      break;
    case 'name':
      leak(FIXTURE_USERS[0]!.displayName);
      break;
    case 'clear-rebuild':
      leak();
      forwarded = '';
      await app.fastify.close();
      await buildApp({ config }).fastify.ready();
      break;
    case 'tracked-background':
      app.drain.track(
        delay(20).then(() => {
          leak();
        }),
      );
      break;
    case 'post-close':
      await app.drain.close();
      leak();
      break;
    case 'after-final-audit':
      break; // emitted by the later root after hook below
    case 'caught-utf8': {
      const audit = createAuditedLogStream();
      for (const byte of Buffer.from('เอกสารประกอบ_ผู้ให้บริการ_2569.pdf'))
        audit.stream.write(Buffer.from([byte]));
      try {
        await audit.settled();
      } catch {
        /* deliberately swallowed; run must still fail */
      }
      break;
    }
    case 'forward-error': {
      const broken = new Writable({
        write(_chunk, _encoding, done) {
          done(new Error('synthetic'));
        },
      });
      const audit = createAuditedLogStream(broken);
      audit.stream.write('safe');
      try {
        await audit.settled();
      } catch {
        /* must still fail */
      }
      break;
    }
    default:
      throw new Error('unknown control');
  }
});
if (scenario === 'safe')
  test('same app survives the between-test audit', async () => {
    assert.equal((await app.fastify.inject('/safe')).statusCode, 200);
  });
after(() => {
  if (scenario === 'after-final-audit')
    setTimeout(() => {
      leak();
    }, 20);
});
