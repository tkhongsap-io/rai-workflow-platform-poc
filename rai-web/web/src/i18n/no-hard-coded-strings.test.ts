// W0-02 section 10 rule 2 for the screens Lane B owns: no JSX text node, no string literal as a JSX child, and no
// string literal in a user-facing attribute (title, alt, placeholder, aria-label, aria-description,
// aria-roledescription, aria-valuetext) anywhere under web/src. ESLint enforces the same through
// react/jsx-no-literals and no-restricted-syntax (eslint.config.js); this test is the belt to that brace and
// runs in `npm run test:unit` with no lint plugin involved. Punctuation-only literals are allowed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const webSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const USER_FACING_ATTRIBUTES: ReadonlySet<string> = new Set([
  'title',
  'alt',
  'placeholder',
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (entry.endsWith('.tsx')) yield full;
  }
}

/** A literal with no letter in any script is punctuation or a number: allowed (the ESLint allow-list). */
function isUserFacingText(text: string): boolean {
  return /\p{L}/u.test(text);
}

export function findHardCodedStrings(file: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.ES2024, true, ts.ScriptKind.TSX);
  const violations: string[] = [];
  const report = (node: ts.Node, what: string): void => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    violations.push(
      `${path.relative(webSrc, file)}:${line + 1} ${what}: ${node.getText().trim().slice(0, 60)}`,
    );
  };
  const isStringLike = (node: ts.Node): boolean =>
    ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node);
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node) && isUserFacingText(node.text)) report(node, 'JSX text');
    if (ts.isJsxExpression(node) && node.expression !== undefined && isStringLike(node.expression)) {
      const parent = node.parent;
      const isChild = ts.isJsxElement(parent) || ts.isJsxFragment(parent);
      if (isChild && isUserFacingText(node.expression.getText())) report(node, 'string literal as JSX child');
    }
    if (ts.isJsxAttribute(node) && USER_FACING_ATTRIBUTES.has(node.name.getText())) {
      const init = node.initializer;
      if (init !== undefined) {
        if (ts.isStringLiteral(init)) report(node, 'string literal in a user-facing attribute');
        else if (ts.isJsxExpression(init) && init.expression !== undefined && isStringLike(init.expression))
          report(node, 'string literal in a user-facing attribute');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

test('no hard-coded user-facing string in any .tsx under web/src (W0-02 section 10 rule 2)', () => {
  const files = [...walk(webSrc)];
  assert.ok(files.length > 0, 'no .tsx files found');
  const violations = files.flatMap((file) => findHardCodedStrings(file, readFileSync(file, 'utf8')));
  assert.deepEqual(violations, []);
});

test('the scanner catches each shape it is meant to catch and allows punctuation', () => {
  const sample = `
    const A = () => <p>Hello</p>;
    const B = () => <p>{'Hello'}</p>;
    const C = () => <button aria-label="Hello" />;
    const D = () => <img alt={'Hello'} />;
    const E = () => <input placeholder={\`Hello\`} />;
    const F = () => <p>{t('x')} · {count}</p>;
    const G = () => <span className="btn" data-status="draft" type="button">{t('y')}</span>;
    const H = () => <p>สวัสดี</p>;
  `;
  const found = findHardCodedStrings(path.join(webSrc, 'sample.tsx'), sample);
  assert.equal(found.length, 6, found.join('\n'));
  assert.ok(found.some((v) => v.includes(':2 ') && v.includes('JSX text')));
  assert.ok(found.some((v) => v.includes(':3 ') && v.includes('JSX child')));
  assert.ok(found.some((v) => v.includes(':4 ') && v.includes('attribute')));
  assert.ok(found.some((v) => v.includes(':5 ') && v.includes('attribute')));
  assert.ok(found.some((v) => v.includes(':6 ') && v.includes('attribute')));
  assert.ok(found.some((v) => v.includes(':9 ') && v.includes('JSX text')));
});
