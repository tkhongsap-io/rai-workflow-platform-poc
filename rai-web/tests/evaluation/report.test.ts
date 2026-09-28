// W4-08a (W4b plan section 11.2 "Report"): `report.json` and `report.md` hold identities, hashes, locators and counts,
// never document text. The whole dev split is run (in-process parsers), written to a temporary directory and grepped
// for every text line, claim line, preamble line and filename of every document. Synthetic documents only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CONFIGURATION_SEED } from '@rai/server/configuration/seed';
import { EVAL_CASES } from '@rai/fixtures/evaluation/cases';
import { claimLine, preambleLines } from '@rai/fixtures/evaluation/render';
import { gradeRun } from './grade.js';
import { catalogueRulesOf, runEvalSet } from './harness.js';
import { buildIdentity, identityDigestOf } from './identity.js';
import { inProcessExtractor } from './in-process-extractor.test-helper.js';
import { loadEvalSet } from './load-set.js';
import { REPORT_SCHEMA, buildReport, reportMarkdown, summaryLines, writeReport } from './report.js';

async function devReport() {
  const set = loadEvalSet('dev');
  const output = await runEvalSet(set, { extractor: inProcessExtractor() });
  const identity = buildIdentity({
    set,
    code: { commit: 'c'.repeat(40), dirty: false },
    runners: output.runners,
    extractorVersion: output.extractorVersion,
    catalogue: CONFIGURATION_SEED.qc_rules,
    templateVersions: CONFIGURATION_SEED.checklist_templates.versions,
  });
  const grade = gradeRun(set, output.parts, catalogueRulesOf(CONFIGURATION_SEED.qc_rules));
  return { identity, report: buildReport(identity, grade, new Date('2026-09-28T01:02:03Z')) };
}

/** Every piece of document text the set renders (lines of 4+ characters) and every filename. */
function documentTexts(): string[] {
  const out = new Set<string>();
  for (const c of EVAL_CASES)
    for (const s of c.slots) {
      if (s.disposition === 'not_applicable') out.add(s.reason);
      if (s.disposition !== 'attached') continue;
      const doc = s.document;
      out.add(doc.filename);
      for (const line of preambleLines(doc)) out.add(line);
      for (const page of doc.pages)
        for (const block of page)
          out.add('claim' in block ? claimLine(block.claim, doc.language) : block.text);
    }
  return [...out].filter((t) => t.trim().length >= 4);
}

test('report.json and report.md carry identities, hashes, locators and counts, and no document text', async () => {
  const { identity, report } = await devReport();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rai-eval-report-'));
  try {
    const written = await writeReport(dir, report);
    assert.deepEqual(written, { json: path.join(dir, 'report.json'), md: path.join(dir, 'report.md') });
    const json = await readFile(written.json, 'utf8');
    const md = await readFile(written.md, 'utf8');
    const parsed = JSON.parse(json) as typeof report;
    assert.equal(parsed.schema, REPORT_SCHEMA);
    assert.equal(parsed.generatedAt, '2026-09-28T01:02:03.000Z');
    assert.deepEqual(parsed.identity, identity);
    assert.equal(parsed.identityDigest, identityDigestOf(identity));
    assert.equal(md, reportMarkdown(report));
    const texts = documentTexts();
    assert.ok(texts.length > 100, `${texts.length} texts`);
    for (const text of texts) {
      assert.ok(
        !json.includes(text) && !json.includes(JSON.stringify(text).slice(1, -1)),
        `report.json holds ${text}`,
      );
      assert.ok(!md.includes(text), `report.md holds ${text}`);
    }
    // No finding message or param reaches the report.
    for (const body of [json, md]) {
      assert.ok(!body.includes('qc.finding.'), 'no message key');
      assert.ok(!body.includes('"message"'), 'no message');
      assert.ok(!body.includes('"params"'), 'no params');
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('report.md names every section, the dataset, the digest and every rule', async () => {
  const { report } = await devReport();
  const md = reportMarkdown(report);
  for (const heading of [
    '# QC evaluation report',
    '## Identity',
    '## Per rule',
    '## Per segment',
    '## Grounded citations',
    '## Unavailable handling',
    '## Lane scope and metadata kept',
    '## Latency',
    '## Failures and cost',
  ])
    assert.ok(md.includes(`\n${heading}\n`) || md.startsWith(`${heading}\n`), heading);
  assert.ok(md.includes(report.identity.dataset.label));
  assert.ok(md.includes(report.identityDigest));
  for (const rule of report.grade.rules) assert.ok(md.includes(`| ${rule.ruleId} |`), rule.ruleId);
  const lines = summaryLines(report);
  assert.ok(lines.some((l) => l.includes(report.identity.dataset.label)));
  assert.ok(lines.some((l) => l.includes(report.identityDigest)));
  assert.ok(lines.some((l) => l.includes('ACC-METRIC-CITED')));
  assert.ok(lines.some((l) => /grounded/i.test(l)));
  assert.ok(lines.some((l) => /p95/.test(l)));
});
