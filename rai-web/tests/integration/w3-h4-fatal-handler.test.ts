// An unhandled rejection anywhere in the server ends the process with one redacted error.captured line and exit 1:
// no message text, no database host or user. The rejection is injected by a test-only preload
// (tests/support/fixtures/leak-rejection-preload.ts); the deployable carries no fault switch. Fixture ids: none.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseDatabaseConfig, readEnv } from '@rai/server/config';
import { RAI_WEB_ROOT, startTestServer } from '../support/process.js';

const PRELOAD = path.join(RAI_WEB_ROOT, 'tests', 'support', 'fixtures', 'leak-rejection-preload.ts');

describe('process-level fatal handler', () => {
  it('an unhandled rejection writes exactly one redacted error.captured line and exits 1', async () => {
    const server = await startTestServer({ env: { NODE_OPTIONS: `--import ${PRELOAD}` } });
    process.kill(server.pid, 'SIGUSR2');
    await server.waitForEvent('error.captured');
    assert.deepEqual(await server.stop(), { code: 1, signal: null });

    const captured = server.linesFor('error.captured');
    assert.equal(captured.length, 1);
    assert.equal(captured[0]!.stream, 'stderr');
    const fields = captured[0]!.fields as Record<string, unknown>;
    assert.equal(fields.category, 'internal_error');
    assert.equal(fields.code, 'internal_error');
    assert.equal(fields.httpStatus, 500);
    assert.equal(server.linesFor('process.stopping').length, 0);

    const stderr = JSON.stringify(server.lines.filter((line) => line.stream === 'stderr'));
    const db = new URL(parseDatabaseConfig(readEnv()).url);
    assert.equal(stderr.includes('synthetic leak'), false, 'the error message reached stderr');
    assert.equal(stderr.includes(db.host), false, 'the database host reached stderr');
    assert.equal(stderr.includes(db.username), false, 'the database user reached stderr');
  });
});
