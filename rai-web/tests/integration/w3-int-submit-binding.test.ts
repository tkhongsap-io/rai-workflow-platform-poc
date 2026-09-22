// Full runtime bytes are retained through child close, including shutdown/drain logs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runObservedSubmitBinding } from '../support/captured-submit-binding.js';

test('fresh committed HTTP submit alone starts QC; replay does not; failure preserves 201 and shutdown drains', async () => {
  await runObservedSubmitBinding();
});
test('captured startup child rejects a deliberate serialized log leak', async () => {
  await assert.rejects(runObservedSubmitBinding(true), /forbidden log canary/);
});
