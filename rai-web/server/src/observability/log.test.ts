import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_CATALOGUE,
  UnregisteredFieldError,
  buildLogLine,
  createEmitter,
  loggerOptions,
} from './log.js';
import { NoContextError, PROCESS_ID, currentContext, mintCorrelationId, runWithContext } from './context.js';

test('the emitter keeps only registered fields and drops the rest outside strict mode (W0-10 4.2 layer 1)', () => {
  const line = buildLogLine(
    'authz.denied',
    { action: 'case.view', reason: 'scope', email: 'dpo@rai-desk.example' } as never,
    {
      strict: false,
      now: new Date('2026-09-21T03:00:00Z'),
      correlationId: null,
    },
  );
  assert.deepEqual(line, {
    time: '2026-09-21T03:00:00.000Z',
    level: 'warn',
    event: 'authz.denied',
    correlationId: null,
    processId: PROCESS_ID,
    fields: { action: 'case.view', reason: 'scope' },
  });
});

test('in strict mode (test and CI) an unregistered field throws OBS_UNREGISTERED_FIELD', () => {
  assert.throws(
    () => buildLogLine('upload.stored', { caseId: 'c', filename: 'เอกสาร.pdf' } as never, { strict: true }),
    (e: unknown) =>
      e instanceof UnregisteredFieldError &&
      e.code === 'OBS_UNREGISTERED_FIELD' &&
      /filename/.test(e.message),
  );
});

test('the correlation id comes from the request context; process-level lines carry null and the process id', async () => {
  const outside = buildLogLine(
    'process.started',
    { identityMode: 'fixture', loopback: true },
    { strict: true },
  );
  assert.equal(outside.correlationId, null);
  assert.equal(outside.processId, PROCESS_ID);
  assert.throws(() => currentContext(), NoContextError);
  const id = mintCorrelationId();
  await runWithContext({ correlationId: id, startedAt: 0 }, () => {
    assert.equal(currentContext().correlationId, id);
    const inside = buildLogLine(
      'request.completed',
      { method: 'GET', route: '/api/session', status: 401 },
      { strict: true },
    );
    assert.equal(inside.correlationId, id);
    return Promise.resolve();
  });
});

test('every catalogue event has a level and a non-empty field list; the W0-05 reason on authz.denied is registered', () => {
  for (const [event, entry] of Object.entries(EVENT_CATALOGUE)) {
    assert.ok(['debug', 'info', 'warn', 'error'].includes(entry.level), event);
    assert.ok(entry.fields.length > 0, event);
  }
  assert.ok((EVENT_CATALOGUE['authz.denied'].fields as readonly string[]).includes('reason'));
});

test('createEmitter writes the line at the catalogue level (or the override) through the pino-style logger', () => {
  const calls: Array<{ level: string; obj: unknown }> = [];
  const fake = new Proxy(
    {},
    { get: (_t, level: string) => (obj: unknown) => calls.push({ level, obj }) },
  ) as never;
  const emitter = createEmitter(fake, { strict: true });
  emitter.log('mail.sent', { notificationId: 'n-1', attempt: 1, sinkKind: 'memory' });
  emitter.log('request.completed', { method: 'GET', route: '/x', status: 500 }, 'error');
  assert.equal(calls[0]?.level, 'info');
  assert.equal(calls[1]?.level, 'error');
  assert.equal((calls[0]?.obj as { event: string }).event, 'mail.sent');
});

test('loggerOptions carries the redaction backstop and never a pretty transport unless asked', () => {
  const plain = loggerOptions({ level: 'info', pretty: false }) as {
    redact: { paths: string[] };
    transport?: unknown;
  };
  assert.ok(plain.redact.paths.includes('req.headers.cookie'));
  assert.ok(plain.redact.paths.includes('*.client_secret'));
  assert.equal(plain.transport, undefined);
  const pretty = loggerOptions({ level: 'debug', pretty: true }) as { transport?: { target: string } };
  assert.equal(pretty.transport?.target, 'pino-pretty');
});
