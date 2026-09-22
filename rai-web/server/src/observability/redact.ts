import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SafeErrorFields } from '@rai/shared/schemas/observability';

type InternalFields = Extract<SafeErrorFields, { category: 'internal_error' }>;
const MODULE_ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Trusted local source/build inventory, not filenames discovered in exception text. */
export function sourceModules(root = MODULE_ROOT): ReadonlyMap<string, string> {
  const inventory = new Map<string, string>();
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.[cm]?[jt]s$/.test(entry.name) || entry.name.endsWith('.test.ts')) continue;
    const absolute = path.join(entry.parentPath, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    if (/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.[cm]?[jt]s$/.test(relative)) inventory.set(absolute, relative);
  }
  return inventory;
}
let inventory: ReadonlyMap<string, string> | undefined;

/** Only known module coordinates survive. Names, messages, function text and provider frames never do. */
export function sanitizeStack(error: unknown, modules?: ReadonlyMap<string, string>): InternalFields {
  const stack: InternalFields['stack'] = [];
  try {
    const known = modules ?? (inventory ??= sourceModules());
    const raw = error instanceof Error && typeof error.stack === 'string' ? error.stack : '';
    for (const line of raw.slice(0, 131_072).split('\n').slice(1, 101)) {
      const match = /(?:\(|\s)(file:\/\/\/[^\s)]+|\/[^\s)]+):(\d+):(\d+)\)?$/.exec(line);
      if (match === null) continue;
      const filename = match[1]!.startsWith('file:') ? fileURLToPath(match[1]!) : match[1]!;
      const module = known.get(filename);
      const row = Number(match[2]);
      const column = Number(match[3]);
      if (
        module === undefined ||
        !Number.isSafeInteger(row) ||
        row < 1 ||
        !Number.isSafeInteger(column) ||
        column < 1
      )
        continue;
      stack.push({ module, line: row, column });
      if (stack.length === 30) break;
    }
  } catch {
    // Even a custom stack getter or malformed URL cannot escape the logging boundary.
  }
  return {
    category: 'internal_error',
    stack,
    stackHash: createHash('sha256').update(JSON.stringify(stack)).digest('hex'),
  };
}

export function inputSurfaces(
  paths: readonly string[],
): Array<'body' | 'querystring' | 'params' | 'headers'> {
  const result = new Set<'body' | 'querystring' | 'params' | 'headers'>();
  for (const value of paths) {
    if (/^(header|headers)([.[]|$)/.test(value)) result.add('headers');
    else if (/^querystring([.[]|$)/.test(value)) result.add('querystring');
    else if (/^params([.[]|$)/.test(value)) result.add('params');
    else result.add('body');
  }
  return [...result];
}
