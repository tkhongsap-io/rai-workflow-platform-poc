/// <reference types="node" />
// W1-06 "no hard-coded user-facing string" (W0-02 section 10.2, D12). Scans every .tsx file of this screen with
// the TypeScript compiler: JSX text must be punctuation or numerals only, and the user-facing attributes
// (title, aria-label, aria-description, placeholder, alt) may not hold a string or template literal. The ESLint
// configuration enforces the same rule repository-wide; this test keeps the screen honest on its own.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const USER_FACING_ATTRIBUTES = new Set(['title', 'aria-label', 'aria-description', 'placeholder', 'alt']);
const ALLOWED_TEXT = /^[\s\-–—:/().,%·0-9]*$/u;

interface Offence {
  file: string;
  line: number;
  kind: 'text' | 'attribute';
  sample: string;
}

function scan(file: string): Offence[] {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const offences: Offence[] = [];
  const at = (node: ts.Node): number => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const value = node.getText(source);
      if (!ALLOWED_TEXT.test(value))
        offences.push({ file, line: at(node), kind: 'text', sample: value.trim().slice(0, 40) });
    }
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(source);
      if (USER_FACING_ATTRIBUTES.has(name) && node.initializer !== undefined) {
        const init = node.initializer;
        const literal =
          ts.isStringLiteral(init) ||
          (ts.isJsxExpression(init) &&
            init.expression !== undefined &&
            (ts.isStringLiteral(init.expression) ||
              ts.isNoSubstitutionTemplateLiteral(init.expression) ||
              ts.isTemplateExpression(init.expression)));
        if (literal) offences.push({ file, line: at(node), kind: 'attribute', sample: init.getText(source) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return offences;
}

test('W1-06 screens: no JSX text and no user-facing attribute outside t() (section 10.2)', () => {
  const files = readdirSync(here)
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => path.join(here, name));
  assert.ok(files.length >= 5, `expected the W1-06 screen files, found ${files.length}`);
  const offences = files.flatMap(scan);
  assert.deepEqual(
    offences.map((o) => `${path.basename(o.file)}:${o.line} ${o.kind} ${JSON.stringify(o.sample)}`),
    [],
  );
});

test('the scanner itself catches a text node and a literal aria-label', () => {
  const sample = path.join(here, '__sample__.tsx');
  const source = ts.createSourceFile(
    sample,
    'export const X = () => <div aria-label="bad" title={`bad`}>Bad text<span>(1)</span></div>;',
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let textOffences = 0;
  let attributeOffences = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node) && !ALLOWED_TEXT.test(node.getText(source))) textOffences += 1;
    if (ts.isJsxAttribute(node) && USER_FACING_ATTRIBUTES.has(node.name.getText(source)))
      attributeOffences += 1;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(textOffences, 1);
  assert.equal(attributeOffences, 2);
});
