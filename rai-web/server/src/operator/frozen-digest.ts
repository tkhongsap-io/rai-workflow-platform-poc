// W7-01 (W7 plan section 3.1 step 4; W0-04 "Schema evolution"): one SHA-256 over the rows W0-04 forbids a
// migration to rewrite, so a backup's manifest, the restored copy (W7-02 `frozen_digest`) and a migration test can
// prove the evidence unchanged without diffing tables. Pure over `exec`: the caller chooses the connection and the
// transaction (the backup reads it inside the snapshot its dump uses).
//
// Canonical form: the JSON object { <table>: [row, ...] } with keys sorted at every depth and no whitespace, rows
// in `id` order, each row as Postgres renders it with to_jsonb. Timestamps inside to_jsonb follow the session
// TimeZone, so the digest refuses to run unless the session is in UTC.

import { createHash } from 'node:crypto';

export type Exec = (text: string) => Promise<readonly Record<string, unknown>[]>;

const all = (table: string) => `SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY t.id`;

/** The W0-04 frozen tables, in canonical order, each with the filter that selects its frozen rows. */
export const FROZEN_TABLES: readonly { table: string; query: string }[] = Object.freeze([
  {
    table: 'pack_version',
    query: 'SELECT to_jsonb(t) AS row FROM "pack_version" t WHERE t.submitted_at IS NOT NULL ORDER BY t.id',
  },
  {
    table: 'artifact_slot',
    query:
      'SELECT to_jsonb(t) AS row FROM "artifact_slot" t WHERE EXISTS (SELECT 1 FROM "pack_version" v WHERE v.id = t.version_id AND v.submitted_at IS NOT NULL) ORDER BY t.id',
  },
  { table: 'artifact', query: all('artifact') },
  { table: 'lane_decision', query: all('lane_decision') },
  { table: 'qc_run', query: all('qc_run') },
  { table: 'qc_finding', query: all('qc_finding') },
  { table: 'disposition_event', query: all('disposition_event') },
  { table: 'audit_event', query: all('audit_event') },
  {
    table: 'configuration_revision',
    query:
      'SELECT to_jsonb(t) AS row FROM "configuration_revision" t WHERE t.published_at IS NOT NULL ORDER BY t.id',
  },
]);

/** JSON with object keys sorted at every depth and no whitespace; `undefined` members are dropped as JSON does. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const UTC_ZONES = new Set(['UTC', 'Etc/UTC']);

/** Lowercase hex SHA-256 of the canonical JSON of the frozen rows. */
export async function frozenDigest(exec: Exec): Promise<string> {
  const [zone] = await exec(`SELECT current_setting('TimeZone') AS tz`);
  if (!UTC_ZONES.has(String(zone?.tz))) throw new Error('frozen_digest_timezone_not_utc');
  const tables: Record<string, unknown[]> = {};
  for (const { table, query } of FROZEN_TABLES) tables[table] = (await exec(query)).map((r) => r.row);
  return createHash('sha256').update(canonicalJson(tables), 'utf8').digest('hex');
}
