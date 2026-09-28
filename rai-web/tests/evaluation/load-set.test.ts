// W4-08a (W4b plan section 11.2): the harness loads a split of `qc-eval-synthetic@1` in memory, checked against the
// committed manifest. Synthetic documents only; nothing is written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EVAL_CASES } from '@rai/fixtures/evaluation/cases';
import { evalSetLabel, readEvalManifest } from '@rai/fixtures/evaluation/generate';
import { EvalSplitUnavailable, loadEvalSet } from './load-set.js';

test('loadEvalSet(dev) returns every dev case with its labels and its documents, checked against the manifest', () => {
  const set = loadEvalSet('dev');
  const manifest = readEvalManifest();
  assert.equal(set.name, 'qc-eval-synthetic');
  assert.equal(set.version, '1');
  assert.equal(set.split, 'dev');
  assert.equal(set.sha256, manifest.sha256);
  assert.equal(set.label, evalSetLabel(manifest));
  assert.deepEqual(
    set.cases.map((c) => c.evalCase.caseId),
    EVAL_CASES.filter((c) => c.split === 'dev').map((c) => c.caseId),
  );
  let documents = 0;
  for (const c of set.cases) {
    assert.equal(c.labels.caseId, c.evalCase.caseId);
    assert.ok(c.labels.runs.length > 0);
    for (const s of c.evalCase.slots) {
      const doc = c.documents.get(s.slot);
      if (s.disposition !== 'attached') {
        assert.equal(doc, undefined);
        continue;
      }
      assert.ok(doc, `${c.evalCase.caseId} slot ${s.slot}`);
      const entry = manifest.documents[doc.documentId];
      assert.ok(entry, doc.documentId);
      assert.equal(doc.sha256, entry.sha256);
      assert.equal(createHash('sha256').update(doc.bytes).digest('hex'), entry.sha256);
      assert.equal(doc.mediaType, entry.mediaType);
      assert.equal(doc.format, entry.format);
      assert.equal(doc.slot, s.slot);
      assert.equal(doc.language, s.document.language);
      documents += 1;
    }
  }
  assert.equal(documents, Object.keys(manifest.documents).length);
});

test('loadEvalSet refuses a split the set does not hold', () => {
  assert.throws(() => loadEvalSet('heldout'), EvalSplitUnavailable);
  assert.throws(() => loadEvalSet('other'), EvalSplitUnavailable);
});
