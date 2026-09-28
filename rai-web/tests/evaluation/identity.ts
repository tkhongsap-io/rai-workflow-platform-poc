// W4-08a (W4b plan section 11.2 "Report"; evaluation plan: "each run records code, prompt/model/provider,
// template/rules, dataset and grader identities"): what produced a report's numbers, and one `identityDigest` over
// all of it. W4-08b's `--verify` recomputes this identity and prints STALE when any part changed ("any
// model/prompt/template change invalidates affected evidence").
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConfigurationBodies } from '@rai/shared/schemas/cases';
import type { LoadedSet } from './load-set.js';

/** Bumped whenever matching, counting or the report shape changes. */
export const GRADER_VERSION = 'rai-qc-eval-grader/1' as const;

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const THRESHOLDS_PATH = path.join(HERE, 'thresholds.json');
/** rai-web/, the directory the thresholds file and the code identity are named from. */
export const RAI_WEB_ROOT = path.resolve(HERE, '..', '..');

export interface RunnerIdentity {
  runner: string;
  runnerVersion: string;
}

export interface EvalIdentity {
  code: { commit: string; dirty: boolean };
  runners: { deterministic: RunnerIdentity; content: RunnerIdentity };
  extractor: { version: string };
  rules: { label: string; bodySha256: string; revision: string };
  templates: string[];
  /** No model port exists before W4-07a and `QC_MODEL` is `disabled`: nothing is named. */
  model:
    | { mode: 'disabled'; provider: null; modelId: null; promptRevision: null }
    | { mode: 'local-fake'; provider: 'local-fake'; modelId: string; promptRevision: string };
  dataset: { name: string; version: string; sha256: string; label: string; split: string };
  grader: { version: string };
  thresholds: { file: string; sha256: string };
}

/** JSON with object keys sorted at every depth; arrays keep their order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) out[key] = sortKeys((value as Record<string, unknown>)[key]);
  return out;
}

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

/**
 * The catalogue label, the sha256 of its canonical body, and the revision ID the harness's requests carry: a
 * UUID-shaped value derived from that digest (no database revision exists in process).
 */
export function rulesIdentity(catalogue: ConfigurationBodies['qc_rules']): EvalIdentity['rules'] {
  const bodySha256 = sha256(canonicalJson(catalogue));
  const h = bodySha256;
  return {
    label: catalogue.label,
    bodySha256,
    revision: `${h.slice(0, 8)}-${h.slice(8, 12)}-7${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`,
  };
}

export type Git = (args: string[]) => string;

const realGit: Git = (args) =>
  execFileSync('git', args, { cwd: RAI_WEB_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/** The checked-out commit and whether the working tree differs from it; `unknown` (dirty) without git. */
export function codeIdentity(git: Git = realGit): EvalIdentity['code'] {
  try {
    const commit = git(['rev-parse', 'HEAD']).trim();
    const dirty = git(['status', '--porcelain', '--untracked-files=no']).trim() !== '';
    return { commit, dirty };
  } catch {
    return { commit: 'unknown', dirty: true };
  }
}

export interface IdentityInput {
  set: Pick<LoadedSet, 'name' | 'version' | 'sha256' | 'label' | 'split'>;
  code: EvalIdentity['code'];
  runners: EvalIdentity['runners'];
  extractorVersion: string;
  catalogue: ConfigurationBodies['qc_rules'];
  templateVersions: readonly string[];
  thresholdsPath?: string;
}

export function buildIdentity(input: IdentityInput): EvalIdentity {
  const thresholdsPath = input.thresholdsPath ?? THRESHOLDS_PATH;
  return {
    code: { ...input.code },
    runners: { deterministic: { ...input.runners.deterministic }, content: { ...input.runners.content } },
    extractor: { version: input.extractorVersion },
    rules: rulesIdentity(input.catalogue),
    templates: [...new Set([...input.templateVersions, ...Object.keys(input.catalogue.templates)])].sort(),
    model: { mode: 'disabled', provider: null, modelId: null, promptRevision: null },
    dataset: {
      name: input.set.name,
      version: input.set.version,
      sha256: input.set.sha256,
      label: input.set.label,
      split: input.set.split,
    },
    grader: { version: GRADER_VERSION },
    thresholds: {
      file: path.relative(RAI_WEB_ROOT, thresholdsPath).split(path.sep).join('/'),
      sha256: sha256(readFileSync(thresholdsPath)),
    },
  };
}

/** sha256 of the canonical JSON of the whole identity. */
export function identityDigestOf(identity: EvalIdentity): string {
  return sha256(canonicalJson(identity));
}
