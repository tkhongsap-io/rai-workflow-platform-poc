import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startedFields } from './started.js';

const withHost = (host: string) => ({
  host,
  identity: { mode: 'local-google' as const, env: Object.freeze({}) },
  buildCommit: 'abc123',
});

test('process.started reports the configured bind host as loopback only when it is one (W0-10 section 3.3)', () => {
  for (const host of ['127.0.0.1', '::1', 'localhost']) {
    assert.deepEqual(startedFields(withHost(host), '9'), {
      identityMode: 'local-google',
      loopback: true,
      schemaVersion: '9',
      commit: 'abc123',
    });
  }
  for (const host of ['0.0.0.0', '::', '172.26.0.2', 'desk.example.test']) {
    assert.equal(startedFields(withHost(host), '9').loopback, false, host);
  }
});
