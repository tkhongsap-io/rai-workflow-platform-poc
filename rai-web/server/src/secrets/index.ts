// W0-03 section 8: where secrets come from, never what they are. Two implementations chosen by RAI_SECRET_SOURCE:
// `env` (process.env, populated by the host's secret manager or the developer's untracked .env) and `file` (one
// file per secret under RAI_SECRET_DIR, the Docker and Kubernetes secret-mount convention, read once at start).
// D10 may add a third implementation behind the same interface; nothing else in the server changes.
//
// Rule S15: an empty, whitespace-only or placeholder value counts as absent, so a forgotten placeholder is a
// start-up refusal rather than a silently empty secret. No secret is logged, echoed or returned anywhere.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type SecretSourceKind = 'env' | 'file';

export interface SecretSource {
  /** Undefined when absent. Empty, whitespace-only and the placeholder literals count as absent (S15). */
  get(name: string): Promise<string | undefined>;
  /** For the start-up log: where secrets come from, never what they are. */
  describe(): SecretSourceKind;
}

/** The sample-file placeholders (W0-02 section 5): `set-in-custody` for secrets, `set-locally` for the local client id. */
export const SECRET_PLACEHOLDERS: ReadonlySet<string> = new Set(['set-in-custody', 'set-locally']);

export function normaliseSecret(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === '' || SECRET_PLACEHOLDERS.has(trimmed)) return undefined;
  return trimmed;
}

export function createEnvSecretSource(env: Readonly<Record<string, string | undefined>>): SecretSource {
  return {
    get: (name) => Promise.resolve(normaliseSecret(env[name])),
    describe: () => 'env',
  };
}

const SECRET_NAME = /^[A-Z][A-Z0-9_]*$/;

export function createFileSecretSource(dir: string): SecretSource {
  const cache = new Map<string, string | undefined>();
  return {
    async get(name) {
      if (!SECRET_NAME.test(name)) return undefined; // a secret name is an identifier, never a path
      if (cache.has(name)) return cache.get(name);
      let value: string | undefined;
      try {
        value = normaliseSecret(await readFile(path.join(dir, name), 'utf8'));
      } catch {
        value = undefined; // absent file = absent secret; the caller refuses to start
      }
      cache.set(name, value); // read once at start and never re-read
      return value;
    },
    describe: () => 'file',
  };
}

export class SecretSourceUnknown extends Error {
  constructor(readonly value: string) {
    super('RAI_SECRET_SOURCE must be env or file');
    this.name = 'SecretSourceUnknown';
  }
}

/** Chooses the source from RAI_SECRET_SOURCE (default `env`) and RAI_SECRET_DIR (default /run/secrets). */
export function createSecretSource(env: Readonly<Record<string, string | undefined>>): SecretSource {
  const kind = env.RAI_SECRET_SOURCE?.trim() || 'env';
  if (kind === 'env') return createEnvSecretSource(env);
  if (kind === 'file') return createFileSecretSource(env.RAI_SECRET_DIR?.trim() || '/run/secrets');
  throw new SecretSourceUnknown(kind);
}
