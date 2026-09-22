import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './start.js';

for (const env of [
  { NODE_ENV: 'production', RAI_IDENTITY_MODE: 'fixture', HOST: '127.0.0.1' },
  { NODE_ENV: 'development', RAI_IDENTITY_MODE: 'fixture', HOST: '127.0.0.1' },
  { NODE_ENV: 'test', RAI_IDENTITY_MODE: 'google', HOST: '127.0.0.1' },
  { NODE_ENV: 'test', RAI_IDENTITY_MODE: 'fixture', HOST: '0.0.0.0' },
  { NODE_ENV: 'test', RAI_IDENTITY_MODE: 'fixture', HOST: 'example.com' },
])
  test(`QC override refuses before config/DB/startup: ${JSON.stringify(env)}`, async () => {
    let touched = false;
    await assert.rejects(
      startServer(env, {
        qcRunner: {
          identity: { runner: 'synthetic', runnerVersion: 'test' },
          run: () => {
            touched = true;
            return Promise.reject(new Error('must not run'));
          },
          probe: () => {
            touched = true;
            return Promise.resolve('ok' as const);
          },
        },
        exit: (code) => {
          assert.equal(code, 78);
          throw new Error('refused-before-config');
        },
        addressOf: () => {
          touched = true;
          throw new Error('must not listen');
        },
      }),
      /refused-before-config/,
    );
    assert.equal(touched, false);
  });
