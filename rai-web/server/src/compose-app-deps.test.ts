// W4-05a (W4b plan section 4.1): composeAppDeps passes the app's BlobStore as `blobs` in every QC binding it creates,
// so the request's read handles stream real bytes in production; which bindings exist is unchanged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { QcRunner } from '@rai/shared/qc/types';
import type { BlobStore } from './artifacts/blob-store.js';
import { composeAppDeps, type ComposeInputs } from './compose-app-deps.js';
import type { Db } from './db/client.js';

const store = { open: () => Promise.reject(new Error('not read here')) } as unknown as BlobStore;
const runner: QcRunner = {
  identity: { runner: 'probe', runnerVersion: '0.0.0' },
  run: () => Promise.reject(new Error('not run here')),
};

function inputs(qcRunner: QcRunner | undefined): ComposeInputs {
  return {
    config: {
      nodeEnv: 'test',
      log: { level: 'info', pretty: false },
      trustProxy: false,
      publicBaseUrl: new URL('http://127.0.0.1:8787'),
      upload: { maxFileBytes: 1, maxPackBytes: 1, maxImagePixels: 1 },
    },
    db: {} as Db,
    adapter: {} as ComposeInputs['adapter'],
    businessUnits: {} as ComposeInputs['businessUnits'],
    store,
    qcRunner,
    readiness: () => Promise.reject(new Error('not read here')),
  };
}

test('with a runner bound, the pack, versions and findings QC bindings carry the store as blobs', () => {
  const deps = composeAppDeps(inputs(runner));
  for (const binding of [deps.pack?.qc, deps.versions?.qc, deps.findings?.qc]) {
    assert.ok(binding !== undefined);
    assert.equal(binding.runner, runner);
    assert.equal(binding.blobs, store);
  }
});

test('with no runner, only the submit binding exists (unchanged) and it carries the store', () => {
  const deps = composeAppDeps(inputs(undefined));
  assert.equal(deps.pack?.qc, undefined);
  assert.equal(deps.findings?.qc, undefined);
  assert.deepEqual(deps.versions?.qc, { blobs: store });
});
