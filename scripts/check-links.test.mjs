// Tests for scripts/check-links.mjs (W0-02 section 6 row 9). Run from the repository root:
// node --test scripts/*.test.mjs. Zero dependencies. Negative cases use a scratch tree, never the repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLinks, extractLinks, headingAnchors, slugify, stripCode, REPO_ROOT } from './check-links.mjs';

const script = fileURLToPath(new URL('./check-links.mjs', import.meta.url));

function scratchTree(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'rai-check-links-'));
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('every relative Markdown link in the repository resolves', () => {
  const result = spawnSync(process.execPath, [script], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^check-links: \d+ Markdown files, \d+ relative links checked, 0 broken/);
});

test('a broken relative link fails with exit 1 and names file, line and target', () => {
  const tree = scratchTree({
    'README.md': '# Root\n\nSee [the plan](docs/plan.md) and [nothing](docs/missing.md).\n',
    'docs/plan.md': '# Plan\n',
  });
  try {
    const result = spawnSync(process.execPath, [script, tree.root], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /README\.md:3 → docs\/missing\.md \(missing: docs\/missing\.md\)/);
    assert.match(result.stderr, /1 broken/);
  } finally {
    tree.cleanup();
  }
});

test('a fragment that names no heading in the target file is broken; a real heading is not', () => {
  const tree = scratchTree({
    'a.md': '# A\n\n[good](b.md#w0-01--stack-adr-d04) [bad](b.md#nope) [same](#a) [code](b.md#casecreate)\n',
    'b.md': '## W0-01 — stack ADR (D04)\n\n### `case.create`\n',
  });
  try {
    const { broken, checked } = checkLinks(tree.root);
    assert.equal(checked, 4);
    assert.deepEqual(broken, ['a.md:3 → b.md#nope (no heading #nope in b.md)']);
  } finally {
    tree.cleanup();
  }
});

test('external URLs, mailto and links inside code are ignored; images and reference definitions are checked', () => {
  const tree = scratchTree({
    'a.md': [
      '# A',
      '',
      '[x](https://example.test/x) <mailto:a@rai-desk.example> [m](mailto:a@rai-desk.example)',
      '`[inline](nope.md)`',
      '```',
      '[fenced](nope.md)',
      '```',
      '![img](img/pic.png)',
      '[ref]: docs/ref.md',
    ].join('\n'),
    'img/pic.png': 'not really a png',
  });
  try {
    const { broken } = checkLinks(tree.root);
    assert.deepEqual(broken, ['a.md:9 → docs/ref.md (missing: docs/ref.md)']);
  } finally {
    tree.cleanup();
  }
});

test('skipped directories are not walked', () => {
  const tree = scratchTree({
    'ok.md': '# ok\n',
    'node_modules/pkg/README.md': '[broken](nope.md)\n',
    'rai-web/dist/x.md': '[broken](nope.md)\n',
  });
  try {
    const { files, broken } = checkLinks(tree.root);
    assert.equal(files, 1);
    assert.deepEqual(broken, []);
  } finally {
    tree.cleanup();
  }
});

test('slugify follows the GitHub heading rule', () => {
  assert.equal(slugify('W0-01 — stack ADR (D04)'), 'w0-01--stack-adr-d04');
  assert.equal(slugify('Edit target (`case.edit_draft`)'), 'edit-target-caseedit_draft');
  assert.equal(slugify('8.3 Fixture identity convention'), '83-fixture-identity-convention');
  assert.equal(slugify('ภาษาไทย ทดสอบ'), 'ภาษาไทย-ทดสอบ');
});

test('duplicate headings get numbered anchors', () => {
  const anchors = headingAnchors('# Same\n\n# Same\n\n## Other\n');
  assert.deepEqual([...anchors], ['same', 'same-1', 'other']);
});

test('extractLinks keeps line numbers and unwraps angle brackets', () => {
  const links = extractLinks('line1\n[a](<x y.md>)\n\n[b](y.md "title")\n[c]: z.md\n');
  assert.deepEqual(links, [
    { target: 'x y.md', line: 2 },
    { target: 'y.md', line: 4 },
    { target: 'z.md', line: 5 },
  ]);
});

test('stripCode keeps line count and blanks fences and inline code', () => {
  const stripped = stripCode('a `code` b\n```\nfenced\n```\nc');
  assert.equal(stripped.split('\n').length, 5);
  assert.ok(!stripped.includes('code') && !stripped.includes('fenced'));
  assert.ok(stripped.includes('a ') && stripped.endsWith('c'));
});
