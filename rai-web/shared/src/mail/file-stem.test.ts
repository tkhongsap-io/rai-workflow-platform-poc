// W7-07 (W7 plan section 5.3): `mailFileStem` moved from the fixtures file sink to @rai/shared so the server's
// in-product file drop and the fixture `FileMailSink` name files identically: sha256(dedupKey) hex, first 16
// characters, a dash and the attempt. No address ever becomes a file name.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { mailFileStem } from './file-stem.js';

test('W7-07: mailFileStem is sha256(dedupKey).hex[0:16]-<attempt>', () => {
  const key = 'lane_open:0192b3c4-0000-7000-8000-000000000201:ai_coe:ai-coe@rai-desk.example';
  const hex = createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 16);
  assert.equal(mailFileStem(key, 1), `${hex}-1`);
  assert.equal(mailFileStem(key, 12), `${hex}-12`);
  assert.match(mailFileStem(key, 3), /^[0-9a-f]{16}-3$/);
  assert.ok(!mailFileStem(key, 1).includes('@'));
});
