#!/usr/bin/env node
// Relative Markdown link check (W0-02 plan, section 6 row 9; ticket W1-12). Zero dependencies; Node 18 or later.
//
// Walks every *.md file under the repository (skipping generated and dependency directories), extracts inline
// links, images and reference definitions, and fails when a relative target does not exist or a fragment names
// a heading the target file does not have. External URLs (http, https, mailto, data), bare in-file anchors on
// non-Markdown targets and anything inside fenced code blocks or inline code are ignored.
//
// Usage: node scripts/check-links.mjs [<root>]   (default: the repository root, the parent of scripts/)
// Exit 0 when every link resolves; exit 1 otherwise, listing file:line → target for each broken link.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const SKIPPED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  '.local',
  'playwright-report',
  'test-results',
  'build',
]);

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:)/i; // any scheme: http:, https:, mailto:, data:, tel:

export function* walkMarkdown(dir) {
  const entries = readdirSync(dir).sort();
  for (const entry of entries) {
    if (SKIPPED_DIRECTORIES.has(entry)) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) yield* walkMarkdown(full);
    else if (entry.toLowerCase().endsWith('.md')) yield full;
  }
}

/** Blanks fenced code blocks and, unless `keepInline`, inline code spans, keeping line numbers intact. */
export function stripCode(markdown, { keepInline = false } = {}) {
  const lines = markdown.split('\n');
  let fence = null;
  const out = lines.map((line) => {
    const open = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence === null && open) {
      fence = open[1][0];
      return '';
    }
    if (fence !== null) {
      if (open && open[1][0] === fence) fence = null;
      return '';
    }
    return keepInline ? line : line.replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
  });
  return out.join('\n');
}

/** Extracts { target, line } for inline links/images and reference definitions. Pure. */
export function extractLinks(markdown) {
  const text = stripCode(markdown);
  const links = [];
  const lineAt = (index) => text.slice(0, index).split('\n').length;
  // Inline: [text](target "title") or ![alt](<target with spaces>)
  const inline = /!?\[[^\]]*\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
  let match;
  while ((match = inline.exec(text)) !== null) {
    links.push({ target: unwrap(match[1]), line: lineAt(match.index) });
  }
  // Reference definitions: [id]: target "title"
  const definition = /^\s{0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)/gm;
  while ((match = definition.exec(text)) !== null) {
    links.push({ target: unwrap(match[1]), line: lineAt(match.index) });
  }
  return links;
}

function unwrap(raw) {
  return raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw;
}

/** GitHub-style heading slug: lower-case, strip punctuation except hyphens and underscores, each space → hyphen. */
export function slugify(heading) {
  const text = heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // link text only
    .replace(/[`*~]/g, '')
    .trim()
    .toLowerCase();
  // GitHub keeps one hyphen per space, so "W0-01 — stack" becomes "w0-01--stack".
  return text.replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
}

/** Every anchor a Markdown file exposes: ATX headings with de-duplication suffixes, plus explicit id attributes. */
export function headingAnchors(markdown) {
  const seen = new Map();
  const anchors = new Set();
  const text = stripCode(markdown, { keepInline: true });
  for (const line of text.split('\n')) {
    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!heading) continue;
    const base = slugify(heading[1]);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  for (const id of markdown.matchAll(/\s(?:id|name)="([^"]+)"/g)) anchors.add(id[1]);
  return anchors;
}

export function checkLinks(root = REPO_ROOT) {
  const broken = [];
  let files = 0;
  let checked = 0;
  const anchorCache = new Map();
  const anchorsOf = (file) => {
    if (!anchorCache.has(file)) anchorCache.set(file, headingAnchors(readFileSync(file, 'utf8')));
    return anchorCache.get(file);
  };
  for (const file of walkMarkdown(root)) {
    files += 1;
    const markdown = readFileSync(file, 'utf8');
    for (const { target, line } of extractLinks(markdown)) {
      if (target === '' || EXTERNAL.test(target)) continue;
      const [rawPath, fragment] = target.split('#', 2);
      let relative;
      try {
        relative = decodeURIComponent(rawPath);
      } catch {
        relative = rawPath;
      }
      const resolved = relative === '' ? file : path.resolve(path.dirname(file), relative);
      checked += 1;
      const location = `${path.relative(root, file)}:${line}`;
      let stat;
      try {
        stat = statSync(resolved);
      } catch {
        broken.push(`${location} → ${target} (missing: ${path.relative(root, resolved)})`);
        continue;
      }
      if (fragment !== undefined && fragment !== '' && stat.isFile() && resolved.toLowerCase().endsWith('.md')) {
        if (!anchorsOf(resolved).has(fragment.toLowerCase())) {
          broken.push(`${location} → ${target} (no heading #${fragment} in ${path.relative(root, resolved)})`);
        }
      }
    }
  }
  return { files, checked, broken };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ? path.resolve(process.argv[2]) : REPO_ROOT;
  const { files, checked, broken } = checkLinks(root);
  for (const b of broken) console.error(`check-links: ${b}`);
  const summary = `check-links: ${files} Markdown files, ${checked} relative links checked, ${broken.length} broken`;
  (broken.length === 0 ? console.log : console.error)(summary);
  process.exit(broken.length === 0 ? 0 : 1);
}
