import assert from 'node:assert/strict';
import path from 'node:path';
import { guard, type RunConfig } from './core.js';
import { recipe } from './seed-recipe.js';
export const SCENARIO = 'perf-enrolled-no-findings-v1';
export const ENGINE = 'substitute-performance-enrolled';
export interface ExpectedCase {
  source_record_id: string;
  use_case_name: string;
  owner_subject_id: string;
  business_owner: string;
  business_unit_id: string;
  business_unit: string;
  technical_owner: string;
  created_by: string;
  vendor_involved: false;
  model_type: 'llm';
  maxVersion: number;
}
export interface LaunchConfig {
  queue: RunConfig;
  mutation: RunConfig;
  target: 'queue' | 'mutation';
  fixtureSha256: string;
  serverRoot: string;
  resourceRoot: string;
  scenario: typeof SCENARIO;
  /** Explicit synthetic mutation recipe, not arbitrary IDs or a wildcard prefix. */
  mutationCases: ExpectedCase[];
}
export const uuid = (value: string) =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export function guardLaunch(c: LaunchConfig) {
  assert(c.target === 'queue' || c.target === 'mutation');
  for (const config of [c.queue, c.mutation]) {
    guard(config);
    assert.equal(config.target.port, 54370);
  }
  assert.notEqual(c.queue.target.database, c.mutation.target.database);
  assert.notEqual(new URL(c.queue.baseUrl).origin, new URL(c.mutation.baseUrl).origin);
  assert.equal(c.queue.finalHead, c.mutation.finalHead);
  assert.equal(c.scenario, SCENARIO);
  assert(/^[a-f0-9]{64}$/.test(c.fixtureSha256));
  assert(path.isAbsolute(c.serverRoot) && path.isAbsolute(c.resourceRoot));
  assert(c.mutationCases.length > 0 && c.mutationCases.length <= 64);
  assert.equal(new Set(c.mutationCases.map((x) => x.source_record_id)).size, c.mutationCases.length);
  for (const row of c.mutationCases) {
    assert(/^TPM-SYNTHETIC-PERF-MUT-[0-9]+$/.test(row.source_record_id));
    assert(row.use_case_name.startsWith('SYNTHETIC-PERF-MUT-'));
    assert(['fixture:fx-user-owner-cm', 'fixture:fx-user-owner-cm-2'].includes(row.owner_subject_id));
    assert.equal(row.business_owner, row.owner_subject_id);
    assert.equal(row.created_by, row.owner_subject_id);
    assert(['CM', 'HR'].includes(row.business_unit_id));
    assert.equal(row.business_unit, row.business_unit_id);
    assert.equal(row.technical_owner, 'Synthetic performance owner');
    assert.equal(row.vendor_involved, false);
    assert.equal(row.model_type, 'llm');
    assert(Number.isInteger(row.maxVersion) && row.maxVersion >= 1 && row.maxVersion <= 2);
  }
}
export function expectedCase(c: LaunchConfig, key: number): ExpectedCase {
  assert(Number.isInteger(key) && key >= 0 && key < (c.target === 'queue' ? 995 : c.mutationCases.length));
  if (c.target === 'mutation') return structuredClone(c.mutationCases[key]!);
  const r = recipe(key),
    owner = `fixture:${r.owner}`;
  return {
    source_record_id: r.sourceRecordId.value,
    use_case_name: r.name,
    owner_subject_id: owner,
    business_owner: owner,
    business_unit_id: r.bu,
    business_unit: r.bu,
    technical_owner: 'Synthetic performance owner',
    created_by: owner,
    vendor_involved: false,
    model_type: 'llm',
    maxVersion: r.resubmit ? 2 : 1,
  };
}
export function proveCase(expected: ExpectedCase, row: Record<string, unknown> | undefined) {
  assert(row, 'missing API-created case');
  for (const [key, value] of Object.entries(expected))
    if (key !== 'maxVersion') assert.deepEqual(row[key], value, `enrollment mismatch: ${key}`);
}
export interface SubmitProof {
  caseId: string;
  versionId: string;
  correlationId: string;
}
export interface Controls {
  readonly target: RunConfig;
  enroll(key: number, caseId: string): Promise<void>;
  submit(proof: SubmitProof): Promise<void>;
  settled(): Promise<void>;
}
export type Query = (text: string, values?: unknown[]) => Promise<Record<string, unknown>[]>;
export type Command = { id: string } & (
  { op: 'enroll'; key: number; caseId: string } | { op: 'submit'; proof: SubmitProof } | { op: 'settled' }
);
export function validCommand(value: unknown): value is Command {
  if (!value || typeof value !== 'object') return false;
  const c = value as Command;
  if (typeof c.id !== 'string' || !uuid(c.id)) return false;
  if (c.op === 'settled') return Object.keys(c).length === 2;
  if (c.op === 'enroll')
    return (
      Object.keys(c).length === 4 &&
      Number.isInteger(c.key) &&
      c.key >= 0 &&
      typeof c.caseId === 'string' &&
      uuid(c.caseId)
    );
  return (
    c.op === 'submit' &&
    Object.keys(c).length === 3 &&
    c.proof !== null &&
    typeof c.proof === 'object' &&
    Object.keys(c.proof).length === 3 &&
    [c.proof.caseId, c.proof.versionId, c.proof.correlationId].every((x) => typeof x === 'string' && uuid(x))
  );
}

export function checkControls(config: RunConfig, controls: Controls) {
  assert(
    controls && JSON.stringify(controls.target) === JSON.stringify(config),
    'controls must match exact guarded server configuration',
  );
}
