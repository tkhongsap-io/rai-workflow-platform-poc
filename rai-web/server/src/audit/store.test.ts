// W1-00 Done when: the audit store has no update or delete path in the data-access layer (runtime enumeration of
// the module's exports; the compile-time half is the AuditStore type). Plus the reference-only rule at append.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as storeModule from './store.js';
import { AUDIT_ACTIONS, AuditRefRejected, auditStore, validateAuditRef } from './store.js';

test('the audit store exposes append and read only; no update or delete path exists', () => {
  assert.deepEqual(Object.keys(auditStore).sort(), ['append', 'read']);
  assert.ok(Object.isFrozen(auditStore));
  const exportedFunctions = Object.entries(storeModule)
    .filter(([, value]) => typeof value === 'function')
    .map(([name]) => name)
    .sort();
  assert.deepEqual(
    exportedFunctions,
    ['AuditRefRejected', 'validateAuditRef'],
    'no module-level write helper beyond the store object',
  );
  for (const name of Object.keys(storeModule)) {
    assert.doesNotMatch(name, /update|delete|remove|purge|truncate/i, `${name} would be a mutation path`);
  }
});

test('the action vocabulary is the W0-06 9.4 list plus the W0-04 and W0-03 additions', () => {
  for (const name of [
    'case.created',
    'draft.saved',
    'version.submitted',
    'lane.opened',
    'risk.proposed', // W5-05 (W0-06 9.4 amended)
    'case.ready_for_launch',
    'qc.run_recorded',
    'configuration.published',
    'configuration.draft_saved', // W6-02 (W6 plan section 10)
    'configuration.draft_discarded', // W6-02
    'audit.read',
    'identity.signed_in',
  ]) {
    assert.ok((AUDIT_ACTIONS as readonly string[]).includes(name), name);
  }
  for (const withdrawn of ['case.edited', 'finding.recorded', 'qc.unavailable', 'case.ready']) {
    assert.equal(
      (AUDIT_ACTIONS as readonly string[]).includes(withdrawn),
      false,
      `${withdrawn} was withdrawn by W0-09`,
    );
  }
});

test('refs hold ids, enum values and numbers; a text excerpt or a long string is rejected (W0-04 audit rule 4)', () => {
  assert.doesNotThrow(() =>
    validateAuditRef(
      {
        current_version_id: '0192b6f4-3a2e-7c1d-8f00-1234567890ab',
        desk_status: 'in_review',
        slot: 3,
        ready: false,
        ids: ['a', 'b'],
      },
      'afterRef',
    ),
  );
  assert.doesNotThrow(() => validateAuditRef(null, 'beforeRef'));
  assert.throws(
    () =>
      validateAuditRef(
        { excerpt: 'The vendor shall process personal data only on documented instructions' },
        'targetRef',
      ),
    AuditRefRejected,
  );
  assert.throws(() => validateAuditRef({ note: 'x'.repeat(65) }, 'targetRef'), /longer than 64/);
  assert.throws(() => validateAuditRef({ filename: 'เอกสารประกอบ.pdf' }, 'targetRef'), /not a reference/);
  assert.throws(() => validateAuditRef({ 'bad key!': 'x' }, 'targetRef'), /key is not a reference/);
  assert.throws(
    () => validateAuditRef({ deep: { deeper: { deepest: { too: 'far' } } } }, 'targetRef'),
    /nested too deep/,
  );
  assert.throws(() => validateAuditRef(['not', 'an', 'object'], 'targetRef'), /must be an object/);
  assert.throws(() => validateAuditRef({ n: Number.NaN }, 'targetRef'), /finite/);
});
