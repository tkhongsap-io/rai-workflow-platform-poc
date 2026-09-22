import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InvalidInputError,
  UnsafeUploadError,
  UnauthenticatedError,
  ForbiddenError,
  NotFoundError,
} from '@rai/shared/errors';
import { createErrorCapture } from './errors.js';
import { buildLogLine, type Emitter, type LogLine } from './log.js';
import { sanitizeStack } from './redact.js';

const id = '11111111-1111-4111-8111-111111111111';
const sentinel = 'RAI-DESK-SYNTHETIC-FIXTURE';
test('safe stack keeps only inventory coordinates, excluding messages, function names and arbitrary paths', () => {
  const error = new Error(sentinel);
  error.stack = `Error: ${sentinel}\n    at ${sentinel} (/safe/app.js:2:8)\n    at /private/${sentinel}.js:1:2\n    at file:///safe/app.js:3:4`;
  const result = sanitizeStack(error, new Map([['/safe/app.js', 'app.js']]));
  assert.deepEqual(result.stack, [
    { module: 'app.js', line: 2, column: 8 },
    { module: 'app.js', line: 3, column: 4 },
  ]);
  assert.equal(JSON.stringify(result).includes(sentinel), false);
  const other = new Error('different message');
  other.stack = error.stack.replaceAll(sentinel, 'other');
  assert.equal(result.stackHash, sanitizeStack(other, new Map([['/safe/app.js', 'app.js']])).stackHash);
});
test('HTTP and job captures use safe fields, correct levels/statuses and bounded counters', () => {
  const lines: LogLine[] = [];
  const emitter: Emitter = {
    log(event, fields, level) {
      const line = buildLogLine(event, fields, {
        strict: true,
        ...(level === undefined ? {} : { level }),
        correlationId: id,
      });
      lines.push(line);
      return line;
    },
  };
  const capture = createErrorCapture(emitter);
  for (const error of [
    new UnauthenticatedError(),
    new ForbiddenError(),
    new NotFoundError('case'),
    new InvalidInputError([{ path: `querystring.${sentinel}`, messageKey: 'validation.required' }]),
    new UnsafeUploadError('filename_invalid', { filename: sentinel }),
  ])
    capture.http(error, '/api/cases/:caseId');
  capture.job({
    category: 'mail_delivery_failed',
    notificationId: id,
    attempts: 4,
    errorCode: 'sink_failure',
  });
  capture.job({ category: 'qc_unavailable', qcRunId: id, caseId: id, versionId: id, reason: 'timeout' });
  assert.deepEqual(
    lines.map((line) => [line.fields.httpStatus, line.level]),
    [
      [401, 'info'],
      [403, 'warn'],
      [404, 'info'],
      [422, 'info'],
      [422, 'warn'],
      [502, 'error'],
      [503, 'error'],
    ],
  );
  assert.equal(JSON.stringify(lines).includes(sentinel), false);
  assert.deepEqual(lines[3]!.fields.fieldPaths, ['querystring']);
  assert.equal(lines[5]!.fields.route, undefined);
  assert.equal(capture.counters().length, 7);
  capture.job({
    category: 'mail_delivery_failed',
    notificationId: id,
    attempts: 4,
    errorCode: sentinel,
  } as never);
  assert.equal(lines.at(-1)!.fields.category, 'internal_error');
  assert.equal(JSON.stringify(lines).includes(sentinel), false);
});
