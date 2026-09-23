import { readManifest, fixtureSetLabel } from '@rai/fixtures/manifest';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { QueueQuery, QueueResponse } from '@rai/shared/schemas/queue';
import { CASE_STATUSES } from '@rai/shared/schemas/cases';
import { FIXTURE_USERS } from '@rai/fixtures/data/users';

export interface RunConfig {
  baseUrl: string;
  target: { host: '127.0.0.1'; port: number; database: string };
  urls: { app: string; owner: string; operator: string };
  finalHead: string;
  authorization: 'parent-authorized-final-head';
}
/** Pure preflight. The parent must separately attest the server uses these exact URLs. */
export function guard(config: RunConfig): void {
  assert.equal(config.authorization, 'parent-authorized-final-head');
  assert.match(config.finalHead, /^[a-f0-9]{40}$/);
  assert.equal(config.target.host, '127.0.0.1');
  assert.match(config.target.database, /^rai_perf_[a-z0-9_]+$/);
  assert(Number.isInteger(config.target.port) && config.target.port > 1024 && config.target.port < 65536);
  assert(![5432, 54320, 54351, 54362, 54363, 54364, 54365].includes(config.target.port));
  for (const role of ['app', 'owner', 'operator'] as const) {
    const url = new URL(config.urls[role]);
    assert.equal(url.protocol, 'postgresql:');
    assert.equal(url.hostname, config.target.host);
    assert.equal(url.port, String(config.target.port));
    assert.equal(url.pathname, `/${config.target.database}`);
    assert.equal(url.username, `rai_${role}`);
    assert(url.password && !url.search && !url.hash);
  }
  const server = new URL(config.baseUrl);
  assert.equal(server.protocol, 'http:');
  assert.equal(server.hostname, '127.0.0.1');
  assert(server.port && server.port !== String(config.target.port));
  assert.equal(server.pathname, '/');
  assert(!server.username && !server.password && !server.search && !server.hash);
}
export function percentile95(values: readonly number[]): number {
  assert(values.length && values.every((n) => Number.isFinite(n) && n >= 0));
  return [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]!;
}
export const hash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function queueShape(value: unknown): asserts value is QueueResponse {
  assert(value && typeof value === 'object');
  const q = value as QueueResponse;
  assert(Number.isInteger(q.total) && q.total >= 0 && Number.isInteger(q.page) && q.page > 0);
  assert(Number.isInteger(q.pageSize) && q.pageSize > 0 && q.pageSize <= 100);
  assert(Array.isArray(q.items) && q.items.length <= q.pageSize);
  assert.equal(new Set(q.items.map((r) => r.caseId)).size, q.items.length);
  for (const r of q.items) {
    for (const s of [r.caseId, r.businessOwner, r.businessUnitId, r.useCaseName, r.useCaseGroup, r.updatedAt])
      assert.equal(typeof s, 'string');
    assert(CASE_STATUSES.includes(r.status) && Array.isArray(r.lanes));
    assert(
      r.currentVersionNumber === null ||
        (Number.isInteger(r.currentVersionNumber) && r.currentVersionNumber > 0),
    );
    assert.equal(r.lanes.length, r.currentVersionNumber === null ? 0 : 3);
    assert.equal(new Set(r.lanes.map((l) => l.lane)).size, r.lanes.length);
    for (const l of r.lanes) {
      assert(['ai_coe', 'dpo', 'it_security'].includes(l.lane));
      assert(['pending', 'approved', 'sent_back'].includes(l.status));
      assert(Number.isFinite(Date.parse(l.due.openedAt)) && /^\d{4}-\d{2}-\d{2}$/.test(l.due.dueOn));
    }
    assert(Number.isInteger(r.latestVersionNumber) && r.latestVersionNumber > 0);
    assert(Number.isFinite(Date.parse(r.updatedAt)));
  }
  for (const s of CASE_STATUSES) assert(Number.isInteger(q.statusCounts[s]) && q.statusCounts[s] >= 0);
  const { owners, ...plain } = q.filterOptions;
  for (const a of Object.values(plain)) assert(Array.isArray(a) && a.every((v) => typeof v === 'string'));
  assert(owners.every((o) => typeof o.value === 'string' && typeof o.label === 'string'));
}
export class Api {
  private cookie = '';
  constructor(readonly baseUrl: string) {}
  async raw(path: string, method = 'GET', body?: unknown) {
    assert(path.startsWith('/') && !path.startsWith('//'));
    const headers = {
      cookie: this.cookie,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
    };
    const start = performance.now();
    const response = await fetch(new URL(path, this.baseUrl), {
      method,
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    const wallMs = performance.now() - start;
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    if (cookie) this.cookie = cookie;
    return {
      text,
      wallMs,
      status: response.status,
      correlationId: response.headers.get('x-correlation-id'),
      bytes: Buffer.byteLength(text),
    };
  }
  async json<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await this.raw(path, method, body);
    assert(response.status >= 200 && response.status < 300, `${method} ${path}: HTTP ${response.status}`);
    return JSON.parse(response.text) as T;
  }
  async signIn(fixtureUserId: string): Promise<void> {
    await this.json('/auth/fixture/sign-in', 'POST', { fixtureUserId });
    assert(this.cookie, 'fixture sign-in missing cookie');
  }
}
export function queuePath(query: QueueQuery): string {
  return `/api/queue?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))}`;
}
export function visible(rows: QueueResponse['items'], userId: string) {
  const user = FIXTURE_USERS.find((u) => u.fixtureUserId === userId);
  assert(user, 'unknown fixture actor');
  return rows.filter((r) =>
    user.roles.some(
      ({ scope }) =>
        scope.kind === 'all_cases' ||
        (scope.kind === 'own_cases'
          ? r.businessOwner === user.subjectId
          : r.businessUnitId === scope.businessUnit),
    ),
  );
}
export function expectedQueue(rows: QueueResponse['items'], user: string, query: QueueQuery): QueueResponse {
  const scope = visible(rows, user);
  const term = (query.search ?? '').trim().normalize('NFC').toLowerCase();
  const matching = scope
    .filter((r) => {
      const source = r.sourceRecordId.kind === 'known' ? r.sourceRecordId.value : 'Unknown';
      const fields = {
        sourceRecordId: [source],
        status: [r.status],
        owner: [r.businessOwner, r.ownerDisplayName],
        useCaseGroup: [r.useCaseGroup],
        all: [
          r.useCaseName,
          r.registryId,
          source,
          r.status,
          r.businessOwner,
          r.ownerDisplayName,
          r.useCaseGroup,
        ],
      };
      return (
        (!query.status || query.status === r.status) &&
        (!query.owner || query.owner === r.businessOwner) &&
        (!query.useCaseGroup || query.useCaseGroup === r.useCaseGroup) &&
        fields[query.searchBy ?? 'all'].some((v) => v.normalize('NFC').toLowerCase().includes(term))
      );
    })
    .sort(
      (a, b) =>
        Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
        (a.caseId < b.caseId ? 1 : a.caseId > b.caseId ? -1 : 0),
    );
  const page = query.page ?? 1,
    pageSize = query.pageSize ?? 25;
  const unique = (a: string[]) => [...new Set(a)].sort();
  return {
    items: matching.slice((page - 1) * pageSize, page * pageSize),
    page,
    pageSize,
    total: matching.length,
    statusCounts: Object.fromEntries(
      CASE_STATUSES.map((s) => [s, scope.filter((r) => r.status === s).length]),
    ) as QueueResponse['statusCounts'],
    filterOptions: {
      statuses: unique(scope.map((r) => r.status)) as QueueResponse['filterOptions']['statuses'],
      owners: unique(scope.map((r) => r.businessOwner)).map((value) => ({
        value,
        label: scope.find((r) => r.businessOwner === value)!.ownerDisplayName,
      })),
      useCaseGroups: unique(scope.map((r) => r.useCaseGroup)),
    },
  };
}
export function durations(
  log: string,
  ids: readonly string[],
  expected: { route: string; status: number } = { route: '/api/queue', status: 200 },
): number[] {
  const found = new Map<string, number[]>();
  for (const line of log.split('\n').filter(Boolean)) {
    const r = JSON.parse(line) as {
      event?: string;
      correlationId?: string;
      fields?: { durationMs?: number; route?: string; status?: number };
    };
    if (r.event !== 'request.completed' || !r.correlationId || !ids.includes(r.correlationId)) continue;
    assert.equal(r.fields?.route, expected.route);
    assert.equal(r.fields.status, expected.status);
    const ms = r.fields.durationMs;
    assert(typeof ms === 'number' && Number.isFinite(ms) && ms >= 0);
    found.set(r.correlationId, [...(found.get(r.correlationId) ?? []), ms]);
  }
  assert.equal(new Set(ids).size, ids.length, 'duplicate sample correlation');
  return ids.map((id) => {
    const a = found.get(id);
    assert.equal(a?.length, 1, `missing/duplicate server duration: ${id}`);
    return a[0]!;
  });
}

export interface Manifest {
  head: string;
  fixture: string;
  rows: QueueResponse['items'];
  sha256: string;
}
export function validateManifest(manifest: Manifest, head: string): void {
  const { sha256, ...content } = manifest;
  assert.equal(content.head, head);
  assert.equal(content.fixture, fixtureSetLabel(readManifest()));
  assert.equal(hash(content), sha256, 'manifest hash mismatch');
  assert.equal(content.rows.length, 1000);
  assert.deepEqual(
    CASE_STATUSES.map((s) => content.rows.filter((r) => r.status === s).length),
    [200, 500, 150, 0, 150],
  );
  assert.equal(content.rows.filter((r) => r.latestVersionNumber === 2).length, 200);
  assert.equal(content.rows.filter((r) => r.currentVersionNumber === 2).length, 50);
  assert.equal(new Set(content.rows.map((r) => r.caseId)).size, 1000);
  for (let page = 1; page <= 10; page++)
    queueShape(expectedQueue(content.rows, 'fx-user-admin', { page, pageSize: 100 }));
}
