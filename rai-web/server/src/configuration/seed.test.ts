import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIGURATION_SEED, SEED_KINDS } from './seed.js';
import { ConfigurationBodyInvalid, validateConfigurationBody } from './store.js';

test('the seed holds the ticket-named kinds with the recorded values (D01, D06, D11, W0-08)', () => {
  assert.deepEqual([...SEED_KINDS].sort(), [
    'calendar',
    'checklist_templates',
    'operator_recipients',
    'sla',
    'use_case_groups',
  ]);
  assert.deepEqual(CONFIGURATION_SEED.sla, { dpo: 3, ai_coe: 5, it_security: 5 });
  assert.equal(CONFIGURATION_SEED.calendar.timezone, 'Asia/Bangkok');
  assert.deepEqual(CONFIGURATION_SEED.operator_recipients.addresses, ['operator-digest@rai-desk.example']);
  assert.deepEqual(CONFIGURATION_SEED.checklist_templates.versions, ['v1.0 Sheet3', 'v2.0']);
  assert.deepEqual(CONFIGURATION_SEED.use_case_groups.groups, [
    'customer-analytics',
    'customer-service',
    'field-operations',
  ]);
  assert.ok(
    !('lane_mapping' in CONFIGURATION_SEED),
    'the lane mapping is a versioned constant, never configuration (D02)',
  );
  assert.ok(!('qc_rules' in CONFIGURATION_SEED), 'qc_rules arrives with the QC substitute (W1-10)');
});

test('every seed body validates against its shared schema', () => {
  for (const kind of SEED_KINDS)
    assert.doesNotThrow(() => validateConfigurationBody(kind, CONFIGURATION_SEED[kind]), kind);
});

test('bodies are validated on write: a wrong shape, an unknown kind and a kind without a schema are refused', () => {
  assert.throws(
    () => validateConfigurationBody('sla', { dpo: 0, ai_coe: 5, it_security: 5 }),
    ConfigurationBodyInvalid,
  );
  assert.throws(
    () => validateConfigurationBody('operator_recipients', { addresses: [] }),
    ConfigurationBodyInvalid,
  );
  assert.throws(
    () => validateConfigurationBody('operator_recipients', { addresses: ['not-an-address'] }),
    ConfigurationBodyInvalid,
  );
  assert.throws(
    () => validateConfigurationBody('calendar', { timezone: 'UTC', holidays: [] }),
    ConfigurationBodyInvalid,
  );
  assert.throws(
    () => validateConfigurationBody('calendar', { timezone: 'Asia/Bangkok', holidays: ['1 Jan'] }),
    ConfigurationBodyInvalid,
  );
  assert.throws(() => validateConfigurationBody('lane_mapping', {}), /unknown kind/);
  assert.throws(() => validateConfigurationBody('risk_rubric', {}), /no body schema registered/);
});
