// W6-04: the mapping from a store problem string (W6-03 `publishProblems`, the schema check) to the W0-06 FieldError
// the Admin API serves. The path is a JSON pointer into the configuration body; the key is a locale key; no prose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLocaleKey } from '@rai/shared/locales/keys';
import { CONFIGURATION_SEED } from './seed.js';
import { PUBLISH_PROBLEM_CODES, publishProblems } from './validate.js';
import { problemFields } from './routes.js';

test('a W6-03 coded problem keeps its full pointer (spaces included) and maps its code to a locale key', () => {
  assert.deepEqual(
    problemFields([
      '/templates/v1.0 Sheet3/rules/2 rule_not_implemented: SYNTH-X is not a rule the product implements',
      '/addresses/0 recipient_not_synthetic: only a synthetic address on a .example or .test domain may be published',
    ]),
    [
      { path: '/templates/v1.0 Sheet3/rules/2', messageKey: 'validation.configuration.rule_not_implemented' },
      { path: '/addresses/0', messageKey: 'validation.configuration.recipient_not_synthetic' },
    ],
  );
});

test('every W6-03 code has a locale key', () => {
  for (const code of PUBLISH_PROBLEM_CODES) assert.ok(isLocaleKey(`validation.configuration.${code}`), code);
});

test('a schema problem keeps only its first pointer segment and never its message', () => {
  assert.deepEqual(problemFields(['/dpo Expected integer to be greater or equal to 1']), [
    { path: '/dpo', messageKey: 'validation.configuration.schema' },
  ]);
  assert.deepEqual(problemFields(['/templates/v1.0 Sheet3/SYNTH-X SYNTH-X params do not match its schema']), [
    { path: '/templates', messageKey: 'validation.configuration.schema' },
  ]);
  assert.deepEqual(problemFields(['/ Expected required property']), [
    { path: '/', messageKey: 'validation.configuration.schema' },
  ]);
});

test('a kind without a schema is not editable; an unknown kind likewise', () => {
  assert.deepEqual(problemFields(['no body schema registered for this kind yet', 'unknown kind']), [
    { path: '/', messageKey: 'validation.configuration.not_editable' },
    { path: '/', messageKey: 'validation.configuration.not_editable' },
  ]);
});

test('every field key the mapping produces for real problems is a locale key', () => {
  const problems = [
    ...publishProblems('sla', { dpo: 0 }, {}, 'sink-file'),
    ...publishProblems('operator_recipients', { addresses: ['a@real.com'] }, {}, 'sink-file'),
    ...publishProblems(
      'checklist_templates',
      { versions: ['v9'] },
      { qc_rules: CONFIGURATION_SEED.qc_rules },
      'sink-file',
    ),
    ...publishProblems('group_role_mapping', {}, {}, 'sink-file'),
  ];
  assert.ok(problems.length >= 4);
  for (const field of problemFields(problems)) {
    assert.ok(isLocaleKey(field.messageKey), field.messageKey);
    assert.ok(field.path.startsWith('/'), field.path);
  }
});
