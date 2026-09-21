// Fails on focus-outline removal outside a :focus-visible rule (W0-02 section 9, item 4). Zero dependencies.
// Scans every .css file and every <style> block or styled string under web/src for `outline: none` / `outline: 0`
// whose enclosing rule selector does not contain :focus-visible.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const webSrc = path.join(root, 'web', 'src');

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

const violations = [];
if (existsSync(webSrc)) {
  for (const file of walk(webSrc)) {
    if (!/\.(css|tsx?|html)$/.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    // Split into rule blocks: "<selector> { <declarations> }" (good enough for authored CSS; no preprocessor).
    const rule = /([^{}]+)\{([^{}]*)\}/g;
    let match;
    while ((match = rule.exec(text)) !== null) {
      const selector = match[1];
      const declarations = match[2];
      if (/outline\s*:\s*(none|0)\b/.test(declarations) && !selector.includes(':focus-visible')) {
        const line = text.slice(0, match.index).split('\n').length;
        violations.push(`${path.relative(root, file)}:${line} removes the outline in "${selector.trim()}"`);
      }
    }
  }
}

if (violations.length > 0) {
  for (const v of violations) console.error(`check-css: ${v}`);
  process.exit(1);
}
console.log('check-css: no outline removal outside :focus-visible');
