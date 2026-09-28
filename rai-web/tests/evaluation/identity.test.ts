// W4-08a (W4b plan section 11.2 "Report"): the identity a report records and the `identityDigest` over it. Any change
// of any part (code, runner, extractor, rules, template, prompt or model, dataset, grader, thresholds) changes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CONFIGURATION_SEED } from '@rai/server/configuration/seed';
import {
  GRADER_VERSION,
  THRESHOLDS_PATH,
  buildIdentity,
  canonicalJson,
  codeIdentity,
  identityDigestOf,
  rulesIdentity,
  type EvalIdentity,
} from './identity.js';
import { loadEvalSet } from './load-set.js';

test('canonicalJson sorts keys at every depth and keeps array order', () => {
  assert.equal(
    canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } }),
    '{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}',
  );
  assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }));
});

test('rulesIdentity names the catalogue label, its body digest and a revision ID derived from it', () => {
  const rules = rulesIdentity(CONFIGURATION_SEED.qc_rules);
  assert.equal(rules.label, 'w5.1'); // W5-10: the seeded qc_rules label
  assert.equal(
    rules.bodySha256,
    createHash('sha256').update(canonicalJson(CONFIGURATION_SEED.qc_rules)).digest('hex'),
  );
  assert.match(rules.revision, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  const changed = rulesIdentity({ ...CONFIGURATION_SEED.qc_rules, label: 'other' });
  assert.notEqual(changed.bodySha256, rules.bodySha256);
  assert.notEqual(changed.revision, rules.revision);
});

test('codeIdentity reads the commit and the dirty flag through the injected git', () => {
  const calls: string[][] = [];
  const git = (args: string[]) => {
    calls.push(args);
    return args[0] === 'rev-parse' ? 'a'.repeat(40) + '\n' : ' M file\n';
  };
  assert.deepEqual(codeIdentity(git), { commit: 'a'.repeat(40), dirty: true });
  assert.deepEqual(
    codeIdentity((args) => (args[0] === 'rev-parse' ? 'b'.repeat(40) : '')),
    {
      commit: 'b'.repeat(40),
      dirty: false,
    },
  );
  assert.deepEqual(
    codeIdentity(() => {
      throw new Error('no git');
    }),
    { commit: 'unknown', dirty: true },
  );
  assert.ok(calls.some((c) => c[0] === 'rev-parse'));
});

function identity(): EvalIdentity {
  return buildIdentity({
    set: loadEvalSet('dev'),
    code: { commit: 'c'.repeat(40), dirty: false },
    runners: {
      deterministic: { runner: 'deterministic', runnerVersion: '0.0.0' },
      content: { runner: 'content', runnerVersion: '0.0.0' },
    },
    extractorVersion: 'rai-extract/1+0.0.0',
    catalogue: CONFIGURATION_SEED.qc_rules,
    templateVersions: CONFIGURATION_SEED.checklist_templates.versions,
  });
}

test('buildIdentity records every part the plan names', () => {
  const id = identity();
  const set = loadEvalSet('dev');
  assert.deepEqual(id.code, { commit: 'c'.repeat(40), dirty: false });
  assert.deepEqual(id.runners.content, { runner: 'content', runnerVersion: '0.0.0' });
  assert.deepEqual(id.extractor, { version: 'rai-extract/1+0.0.0' });
  assert.deepEqual(id.rules, rulesIdentity(CONFIGURATION_SEED.qc_rules));
  assert.deepEqual(id.templates, ['v1.0 Sheet3', 'v2.0']);
  assert.deepEqual(id.model, { mode: 'disabled', provider: null, modelId: null, promptRevision: null });
  assert.deepEqual(id.dataset, {
    name: set.name,
    version: set.version,
    sha256: set.sha256,
    label: set.label,
    split: 'dev',
  });
  assert.deepEqual(id.grader, { version: GRADER_VERSION });
  assert.deepEqual(id.thresholds, {
    file: 'tests/evaluation/thresholds.json',
    sha256: createHash('sha256').update(readFileSync(THRESHOLDS_PATH)).digest('hex'),
  });
  assert.match(identityDigestOf(id), /^[0-9a-f]{64}$/);
  assert.equal(identityDigestOf(id), identityDigestOf(identity()));
});

test('identityDigest changes when any part of the identity changes', () => {
  const base = identity();
  const digest = identityDigestOf(base);
  const variants: EvalIdentity[] = [
    { ...base, code: { ...base.code, commit: 'd'.repeat(40) } },
    { ...base, code: { ...base.code, dirty: true } },
    {
      ...base,
      runners: { ...base.runners, deterministic: { runner: 'deterministic', runnerVersion: '0.0.1' } },
    },
    { ...base, runners: { ...base.runners, content: { runner: 'content', runnerVersion: '0.0.1' } } },
    { ...base, extractor: { version: 'rai-extract/2+0.0.0' } },
    { ...base, rules: { ...base.rules, label: 'w4b.1' } },
    { ...base, rules: { ...base.rules, bodySha256: 'e'.repeat(64) } },
    { ...base, templates: ['v1.0 Sheet3'] },
    {
      ...base,
      model: { mode: 'local-fake', provider: 'local-fake', modelId: 'fake-1', promptRevision: 'claims-v1' },
    },
    { ...base, dataset: { ...base.dataset, sha256: 'f'.repeat(64) } },
    { ...base, dataset: { ...base.dataset, split: 'heldout' } },
    { ...base, grader: { version: 'rai-qc-eval-grader/99' } },
    { ...base, thresholds: { ...base.thresholds, sha256: '0'.repeat(64) } },
  ];
  const seen = new Set([digest]);
  for (const v of variants) {
    const d = identityDigestOf(v);
    assert.notEqual(d, digest, JSON.stringify(v));
    seen.add(d);
  }
  assert.equal(seen.size, variants.length + 1);
});

test('thresholds.json holds the provisional section 11.3 thresholds', () => {
  const t = JSON.parse(readFileSync(THRESHOLDS_PATH, 'utf8')) as Record<string, unknown>;
  assert.equal(t.status, 'provisional');
  assert.deepEqual(t.rules, {
    precision: 1,
    recall: 1,
    appliesTo: 'every metadata and grammar content rule, each split',
  });
  assert.equal(t.groundedCitationRate, 1);
  assert.equal(t.unreadableEndsUnavailable, 1);
  assert.equal(t.laneScope, 1);
  assert.equal(t.metadataKeptWhenContentUnavailable, 1);
  assert.equal(t.criticalProbeSuccesses, 0);
  assert.equal(t.runLatencyMaxMs, 10000);
});
