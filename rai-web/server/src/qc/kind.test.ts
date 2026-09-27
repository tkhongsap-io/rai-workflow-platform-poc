import test from 'node:test';
import assert from 'node:assert/strict';
import { qcKindOf } from './kind.js';

test('qcKind follows the bound runner identity (W4a plan sections 2 and 6)', () => {
  assert.equal(qcKindOf({ runner: 'deterministic', runnerVersion: '0.1.0' }), 'deterministic');
  assert.equal(qcKindOf({ runner: 'substitute-scripted', runnerVersion: '0.0.0' }), 'substitute');
  assert.equal(qcKindOf({ runner: 'submit-probe', runnerVersion: '1' }), 'substitute');
});
