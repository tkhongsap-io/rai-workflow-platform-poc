// W6-03 (W6 plan section 2.4): `publishProblems`, the cross-kind and registry checks of the Admin publish and restore
// paths. Pure: bodies and the revisions in force are passed in. Synthetic values only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ConfigurationBodies } from '@rai/shared/schemas/cases';
import {
  GroupRoleMappingSchema as SharedGroupRoleMappingSchema,
  type GroupRoleMapping,
} from '@rai/shared/schemas/identity-mapping';
import { GroupRoleMappingSchema as ServerGroupRoleMappingSchema } from '../identity/group-mapping.js';
import { ACC_BAND_V1_SHEET3_PARAMS, CONFIGURATION_SEED, UNSEEDED_KINDS } from './seed.js';
import { PUBLISH_PROBLEM_CODES, publishProblems, type InForceBodies } from './validate.js';

type QcRules = ConfigurationBodies['qc_rules'];
type QcRule = QcRules['templates'][string]['rules'][number];

const SEED_IN_FORCE: InForceBodies = {
  checklist_templates: CONFIGURATION_SEED.checklist_templates,
  qc_rules: CONFIGURATION_SEED.qc_rules,
};
const clone = <T>(value: T): T => structuredClone(value);

/** The seed catalogue with `edit` applied to one template's rule list. */
function catalogue(template: string, edit: (rules: QcRule[]) => QcRule[]): QcRules {
  const body = clone(CONFIGURATION_SEED.qc_rules);
  body.templates[template] = { rules: edit(body.templates[template]!.rules) };
  return body;
}

// The pointer may hold spaces (`/templates/v1.0 Sheet3/...`); the code is the first ` <code>: `.
const codeOf = (problem: string) => / ([a-z_]+): /.exec(problem)?.[1];

test('every seeded body passes publishProblems against the seeded revisions in force, under both sink modes', () => {
  for (const mode of ['sink-file', 'sink-memory'] as const)
    for (const [kind, body] of Object.entries(CONFIGURATION_SEED))
      assert.deepEqual(publishProblems(kind, body, SEED_IN_FORCE, mode), [], kind);
});

test('the schema runs first: an invalid body, an unknown kind or a kind without a schema returns only those problems', () => {
  const invalid = publishProblems('sla', { dpo: 0, ai_coe: 5, it_security: 5 }, SEED_IN_FORCE, 'sink-file');
  assert.equal(invalid.length, 1);
  assert.match(invalid[0]!, /^\/dpo /);
  assert.deepEqual(publishProblems('lane_mapping', {}, SEED_IN_FORCE, 'sink-file'), ['unknown kind']);
  // W6-11: every registered kind now has a schema, so the mapping's empty body gets schema problems only.
  const mapping = publishProblems('group_role_mapping', {}, SEED_IN_FORCE, 'sink-file');
  assert.ok(mapping.length > 0);
  for (const p of mapping) assert.doesNotMatch(p, /no body schema registered/);
  // qcRulesBodyProblems still runs (a rule listed twice), before any registry check.
  const twice = catalogue('v2.0', (rules) => [...rules, rules[0]!]);
  const problems = publishProblems('qc_rules', twice, SEED_IN_FORCE, 'sink-file');
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /listed twice/);
});

test('a catalogue entry whose rule ID is not implemented is refused (Q6: it would silently not run)', () => {
  const body = catalogue('v2.0', (rules) => [
    ...rules,
    { ruleId: 'ACC-NOT-BUILT', engine: 'content', triggers: ['approve_attempt'], severity: 'low' },
  ]);
  const problems = publishProblems('qc_rules', body, SEED_IN_FORCE, 'sink-file');
  const at = body.templates['v2.0']!.rules.length - 1;
  assert.deepEqual(problems, [
    `/templates/v2.0/rules/${at} rule_not_implemented: ACC-NOT-BUILT is not a rule the product implements`,
  ]);
});

test('an engine that differs from the registry is refused', () => {
  const body = catalogue('v1.0 Sheet3', (rules) =>
    rules.map((rule) => (rule.ruleId === 'PACK-NA-VENDOR-DOC' ? { ...rule, engine: 'content' } : rule)),
  );
  const problems = publishProblems('qc_rules', body, SEED_IN_FORCE, 'sink-file');
  assert.equal(problems.length, 1);
  assert.equal(codeOf(problems[0]!), 'rule_engine_mismatch');
  assert.match(problems[0]!, /^\/templates\/v1\.0 Sheet3\/rules\/2 /);
});

test("triggers must be a subset of the registry's: a superset is refused, a subset is accepted", () => {
  const superset = catalogue('v2.0', (rules) =>
    rules.map((rule) =>
      rule.ruleId === 'PACK-STAGE-MISMATCH' ? { ...rule, triggers: ['submit', 'upload'] } : rule,
    ),
  );
  const problems = publishProblems('qc_rules', superset, SEED_IN_FORCE, 'sink-file');
  assert.equal(problems.length, 1);
  assert.equal(codeOf(problems[0]!), 'rule_trigger_not_implemented');
  assert.match(problems[0]!, /upload/);

  const subset = catalogue('v2.0', (rules) =>
    rules.map((rule) => (rule.ruleId === 'PACK-SLOT-MISSING' ? { ...rule, triggers: ['submit'] } : rule)),
  );
  assert.deepEqual(publishProblems('qc_rules', subset, SEED_IN_FORCE, 'sink-file'), []);
});

test('v2.0 may not list the v1.0 Sheet-3 band rule (L12, template isolation)', () => {
  // W4-06c: the band rule's params schema is registered, so the entry carries its params (else the schema refuses it
  // first and the isolation check never runs).
  const body = catalogue('v2.0', (rules) => [
    ...rules,
    {
      ruleId: 'ACC-BAND-V1-SHEET3',
      engine: 'content',
      triggers: ['approve_attempt'],
      severity: 'high',
      params: ACC_BAND_V1_SHEET3_PARAMS,
    },
  ]);
  const problems = publishProblems('qc_rules', body, SEED_IN_FORCE, 'sink-file');
  assert.equal(problems.length, 1);
  assert.equal(codeOf(problems[0]!), 'rule_template_isolated');
  assert.match(problems[0]!, /^\/templates\/v2\.0\/rules\/\d+ /);
  // The same rule stays valid where it belongs.
  assert.deepEqual(publishProblems('qc_rules', CONFIGURATION_SEED.qc_rules, SEED_IN_FORCE, 'sink-file'), []);
});

test('template coverage, qc_rules first: a catalogue must cover every version in force', () => {
  const partial = clone(CONFIGURATION_SEED.qc_rules);
  delete partial.templates['v2.0'];
  const problems = publishProblems('qc_rules', partial, SEED_IN_FORCE, 'sink-file');
  assert.equal(problems.length, 1);
  assert.equal(codeOf(problems[0]!), 'catalogue_missing_template');
  assert.match(problems[0]!, /^\/templates catalogue_missing_template: .*v2\.0/);
  // A catalogue with an extra template is fine: adding it to checklist_templates comes second.
  const extended = clone(CONFIGURATION_SEED.qc_rules);
  extended.templates['v3.0'] = clone(extended.templates['v2.0']!);
  assert.deepEqual(publishProblems('qc_rules', extended, SEED_IN_FORCE, 'sink-file'), []);
  // No checklist_templates in force: nothing to cover.
  assert.deepEqual(
    publishProblems('qc_rules', partial, { qc_rules: CONFIGURATION_SEED.qc_rules }, 'sink-file'),
    [],
  );
});

test('template coverage, checklist_templates second: every version needs an entry in the catalogue in force', () => {
  const body = { versions: ['v1.0 Sheet3', 'v2.0', 'v3.0'] };
  const problems = publishProblems('checklist_templates', body, SEED_IN_FORCE, 'sink-file');
  assert.equal(problems.length, 1);
  assert.equal(codeOf(problems[0]!), 'template_not_in_catalogue');
  assert.match(problems[0]!, /^\/versions\/2 template_not_in_catalogue: v3\.0/);
  // Once the catalogue in force has v3.0, the same body publishes.
  const extended = clone(CONFIGURATION_SEED.qc_rules);
  extended.templates['v3.0'] = clone(extended.templates['v2.0']!);
  assert.deepEqual(
    publishProblems('checklist_templates', body, { ...SEED_IN_FORCE, qc_rules: extended }, 'sink-file'),
    [],
  );
  // With no qc_rules in force, every version is uncovered (fail closed).
  const none = publishProblems(
    'checklist_templates',
    CONFIGURATION_SEED.checklist_templates,
    { checklist_templates: CONFIGURATION_SEED.checklist_templates },
    'sink-file',
  );
  assert.deepEqual(none.map(codeOf), ['template_not_in_catalogue', 'template_not_in_catalogue']);
});

test('operator_recipients must be synthetic (.example or .test) while mail is a sink', () => {
  for (const mode of ['sink-file', 'sink-memory'] as const) {
    const problems = publishProblems(
      'operator_recipients',
      {
        addresses: [
          'operator-digest@rai-desk.example',
          'external@real.com',
          'drill@desk.test',
          'someone@example.com',
          'x@desk.invalid',
        ],
      },
      SEED_IN_FORCE,
      mode,
    );
    assert.deepEqual(
      problems.map((p) => p.split(':')[0]),
      [
        '/addresses/1 recipient_not_synthetic',
        '/addresses/3 recipient_not_synthetic',
        '/addresses/4 recipient_not_synthetic',
      ],
    );
    assert.ok(!problems.join(' ').includes('real.com'), 'a problem never echoes an address');
  }
});

test('other kinds are checked by schema only; a pointer segment is escaped', () => {
  assert.deepEqual(
    publishProblems('sla', { dpo: 4, ai_coe: 5, it_security: 5 }, SEED_IN_FORCE, 'sink-file'),
    [],
  );
  assert.deepEqual(
    publishProblems(
      'desk_controls',
      { writesFrozen: true, mailPaused: false, qcPaused: false },
      {},
      'sink-file',
    ),
    [],
  );
  const body = clone(CONFIGURATION_SEED.qc_rules);
  body.templates['a/b~c'] = {
    rules: [{ ruleId: 'ACC-NOPE', engine: 'content', triggers: ['upload'], severity: 'low' }],
  };
  const problems = publishProblems('qc_rules', body, SEED_IN_FORCE, 'sink-file');
  assert.deepEqual(
    problems.map((p) => p.split(' ')[0]),
    ['/templates/a~1b~0c/rules/0'],
  );
});

test('every cross-kind problem carries a known code after its pointer', () => {
  const body = catalogue('v2.0', (rules) => [
    ...rules,
    { ruleId: 'ACC-NOT-BUILT', engine: 'content', triggers: ['upload'], severity: 'low' },
    {
      ruleId: 'ACC-BAND-V1-SHEET3',
      engine: 'metadata',
      triggers: ['submit'],
      severity: 'high',
      params: ACC_BAND_V1_SHEET3_PARAMS, // W4-06c: schema-valid, so the cross-kind checks run
    },
  ]);
  const problems = publishProblems('qc_rules', body, SEED_IN_FORCE, 'sink-file');
  assert.ok(problems.length >= 3);
  for (const problem of problems)
    assert.ok((PUBLISH_PROBLEM_CODES as readonly string[]).includes(codeOf(problem) ?? ''), problem);
});

// W6-11 (W6 plan section 6): the identity mapping is registered but never seeded. Synthetic values only: the all-zero
// tenant and `fx-group-*` IDs.
const SYNTHETIC_MAPPING: GroupRoleMapping = {
  kind: 'identity.group_role_mapping',
  version: 1,
  tenantId: '00000000-0000-0000-0000-000000000000',
  rules: [
    { groupObjectId: 'fx-group-owner', role: 'owner' },
    { groupObjectId: 'fx-group-spoc-cm', role: 'bu_spoc', businessUnit: 'CM' },
    { groupObjectId: 'fx-group-ai-coe', role: 'ai_coe' },
    { groupObjectId: 'fx-group-dpo', role: 'dpo' },
    { groupObjectId: 'fx-group-it-security', role: 'it_security' },
    { groupObjectId: 'fx-group-admin', role: 'admin' },
  ],
};

test('group_role_mapping: the server path re-exports the shared schema, and the kind stays unseeded', () => {
  assert.equal(ServerGroupRoleMappingSchema, SharedGroupRoleMappingSchema);
  assert.ok((UNSEEDED_KINDS as readonly string[]).includes('group_role_mapping'));
  assert.ok(!Object.hasOwn(CONFIGURATION_SEED, 'group_role_mapping'));
});

test('group_role_mapping: a synthetic mapping may be published, under both sink modes and with nothing in force', () => {
  for (const mode of ['sink-file', 'sink-memory'] as const) {
    assert.deepEqual(publishProblems('group_role_mapping', SYNTHETIC_MAPPING, SEED_IN_FORCE, mode), [], mode);
    assert.deepEqual(publishProblems('group_role_mapping', SYNTHETIC_MAPPING, {}, mode), [], mode);
  }
  assert.deepEqual(
    publishProblems('group_role_mapping', { ...SYNTHETIC_MAPPING, rules: [] }, SEED_IN_FORCE, 'sink-file'),
    [],
  );
});

test('group_role_mapping: an invalid mapping is refused with schema problems at its pointer, never a coded one', () => {
  const cases: Array<[unknown, RegExp]> = [
    [{ ...SYNTHETIC_MAPPING, kind: 'group_role_mapping' }, /^\/kind /],
    [{ ...SYNTHETIC_MAPPING, version: 2 }, /^\/version /],
    [{ ...SYNTHETIC_MAPPING, tenantId: '' }, /^\/tenantId /],
    [{ ...SYNTHETIC_MAPPING, rules: [{ groupObjectId: 'fx-group-x', role: 'superuser' }] }, /^\/rules\/0/],
    [{ ...SYNTHETIC_MAPPING, rules: [{ groupObjectId: 'fx-group-x', role: 'bu_spoc' }] }, /^\/rules\/0/],
    [{ kind: 'identity.group_role_mapping', version: 1, rules: [] }, /^\/ /],
  ];
  for (const [body, at] of cases) {
    const problems = publishProblems('group_role_mapping', body, SEED_IN_FORCE, 'sink-file');
    assert.ok(problems.length > 0, JSON.stringify(body));
    assert.ok(
      problems.some((p) => at.test(p)),
      `${JSON.stringify(body)}: ${problems.join(' | ')}`,
    );
    for (const p of problems) assert.equal(codeOf(p), undefined, p);
  }
});
