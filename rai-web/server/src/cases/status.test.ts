// W0-06 2.4 rows in order, first match wins; the desk_status mirror follows W0-04's mapping.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveCaseStatus, deskStatusFor } from './status.js';

test('draft: current version is a draft with no parent; sent_back: a draft with a parent', () => {
  assert.equal(deriveCaseStatus({ draft: { parentVersionId: null }, current: null }), 'draft');
  assert.equal(
    deriveCaseStatus({ draft: { parentVersionId: 'v1' }, current: { readyAt: null } }),
    'sent_back',
  );
});

test('in_review: submitted and no open draft; awaiting_disposition only with all lanes approved and an open finding', () => {
  assert.equal(deriveCaseStatus({ draft: null, current: { readyAt: null } }), 'in_review');
  assert.equal(
    deriveCaseStatus({
      draft: null,
      current: { readyAt: null },
      review: { allLanesApproved: true, undispositionedFindings: 0 },
    }),
    'in_review',
  );
  assert.equal(
    deriveCaseStatus({
      draft: null,
      current: { readyAt: null },
      review: { allLanesApproved: true, undispositionedFindings: 2 },
    }),
    'awaiting_disposition',
  );
});

test('ready_for_launch wins over everything once ready_at is set', () => {
  assert.equal(deriveCaseStatus({ draft: null, current: { readyAt: new Date() } }), 'ready_for_launch');
});

test('desk_status mirror: draft ← draft/sent_back; in_review ← in_review/awaiting_disposition; ready ← ready_for_launch', () => {
  assert.equal(deskStatusFor('draft'), 'draft');
  assert.equal(deskStatusFor('sent_back'), 'draft');
  assert.equal(deskStatusFor('in_review'), 'in_review');
  assert.equal(deskStatusFor('awaiting_disposition'), 'in_review');
  assert.equal(deskStatusFor('ready_for_launch'), 'ready');
});
