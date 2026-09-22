// W0-07 section 3.9 "fail closed on configuration", the part this ticket owns: `QC_MODE` has exactly one slice-1
// value (`substitute`, W0-02 section 5); unset or any other value (`none`, `scripted`, `model`, a `QC_RUNNER`
// spelling) is refused by the W1-00 loader in every identity mode, and the runner the value selects identifies
// itself as `substitute-scripted`, which readiness reports as `qc.kind = 'substitute'` (W0-10 5.3). The loader's
// refusal of `production` identity together with `substitute` is W1-00's row and is not in `config.ts` today; see
// the review note. QC has no "disabled" value: W0-07 section 10 proposes one and no ticket adds it until recorded.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, parseConfig, type Env } from '@rai/server/config';
import { ScriptedQcRunner } from './scripted-runner.js';

const base: Record<string, string> = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: '8787',
  PUBLIC_BASE_URL: 'http://127.0.0.1:8787',
  TRUST_PROXY: 'false',
  DATABASE_URL: 'postgres://rai_app:rai_app@127.0.0.1:54330/rai',
  DATABASE_MIGRATE_URL: 'postgres://rai_owner:rai_owner@127.0.0.1:54330/rai',
  DATABASE_OPERATOR_URL: '',
  BLOB_DIR: './.local/blobs',
  UPLOAD_MAX_FILE_BYTES: '26214400',
  UPLOAD_MAX_PACK_BYTES: '157286400',
  UPLOAD_MAX_IMAGE_PIXELS: '40000000',
  IDEMPOTENCY_TTL_HOURS: '72',
  BLOB_ORPHAN_MIN_AGE_HOURS: '24',
  BLOB_TMP_MAX_AGE_HOURS: '1',
  RAI_IDENTITY_MODE: 'fixture',
  MAIL_MODE: 'sink-memory',
  MAIL_SINK_DIR: './.local/mail',
  QC_MODE: 'substitute',
  LOG_LEVEL: 'info',
  LOG_PRETTY: 'false',
  BUILD_COMMIT: 'dev',
};

const identityModes: Record<string, Record<string, string>> = {
  fixture: { NODE_ENV: 'test', RAI_IDENTITY_MODE: 'fixture' },
  'local-google': { NODE_ENV: 'development', RAI_IDENTITY_MODE: 'local-google' },
  network: { NODE_ENV: 'development', RAI_IDENTITY_MODE: 'network' },
  production: { NODE_ENV: 'production', RAI_IDENTITY_MODE: 'production' },
};

function reasonOf(env: Env): string | null {
  try {
    parseConfig(env);
    return null;
  } catch (err) {
    if (err instanceof ConfigError) return err.reason;
    throw err;
  }
}

test('QC_MODE=substitute is accepted and selects the substitute-scripted runner identity', () => {
  const config = parseConfig(base);
  assert.equal(config.qc.mode, 'substitute');
  const runner = new ScriptedQcRunner();
  assert.equal(runner.identity.runner, 'substitute-scripted');
  // W0-10 5.3: the readiness `qc.kind` for this runner is 'substitute'; the label the operator view shows.
  const qcKind: 'substitute' | 'deterministic' | 'model' = config.qc.mode;
  assert.equal(qcKind, 'substitute');
});

test('QC_MODE unset or any value other than substitute is refused in every identity mode, naming the key', () => {
  for (const [modeName, modeEnv] of Object.entries(identityModes)) {
    assert.equal(
      reasonOf({ ...base, ...modeEnv, QC_MODE: undefined }),
      'missing:QC_MODE',
      `${modeName}: unset`,
    );
    assert.equal(reasonOf({ ...base, ...modeEnv, QC_MODE: '' }), 'missing:QC_MODE', `${modeName}: empty`);
    for (const value of ['none', 'scripted', 'model', 'real', 'disabled', 'Substitute']) {
      const reason = reasonOf({ ...base, ...modeEnv, QC_MODE: value });
      assert.equal(
        reason,
        value === 'substitute ' ? null : 'invalid:QC_MODE',
        `${modeName}: QC_MODE=${JSON.stringify(value)}`,
      );
    }
  }
  // A `QC_RUNNER` variable is not a key W0-02 defines: it neither enables nor disables anything, and QC_MODE is
  // still required beside it.
  assert.equal(reasonOf({ ...base, QC_MODE: undefined, QC_RUNNER: 'none' }), 'missing:QC_MODE');
  assert.equal(reasonOf({ ...base, QC_RUNNER: 'none' }), null);
});
