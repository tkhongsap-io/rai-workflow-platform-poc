// The desk_status mirror follows W0-04's mapping. The derivation itself is SQL, covered by w3-01-queue.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deskStatusFor } from './status.js';

test('desk_status mirror: draft ← draft/sent_back; in_review ← in_review/awaiting_disposition; ready ← ready_for_launch', () => {
  assert.equal(deskStatusFor('draft'), 'draft');
  assert.equal(deskStatusFor('sent_back'), 'draft');
  assert.equal(deskStatusFor('in_review'), 'in_review');
  assert.equal(deskStatusFor('awaiting_disposition'), 'in_review');
  assert.equal(deskStatusFor('ready_for_launch'), 'ready');
});
