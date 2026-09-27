// W4a real-server evidence (W4a plan section 8, first added by W4-03): the one deployable spawned from source
// (`server/src/main.ts` through tsx, tests/support/process.ts) with `QC_MODE=deterministic`, on loopback in test
// mode against this suite's Postgres with fixture set slice1-synthetic@1 loaded. Every request goes over HTTP with a
// session cookie from POST /auth/fixture/sign-in. It reads readiness `qc.kind`, the stored `PACK-*` findings of the
// three W4a metadata rules through the findings endpoint, the `qc_run` rows (runner identity, `rules_evaluated`) and
// the `qc.run.*` lines. Since W4-13, `deterministic` is valid in every environment and `.env.example` sets it; the
// test harness (tests/support/process.ts) pins `substitute`, so this file overrides it. W4-12 extends this file with
// the qc-runs endpoint. Slot and stage edits go through the
// save-draft route before submit; no document is parsed and nothing leaves the host.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import { loadFixtures } from '@rai/fixtures/load';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import type { CaseView } from '@rai/shared/schemas/cases';
import type { ReadinessReport } from '@rai/shared/schemas/observability';
import type { PackDraft, PackDraftUpdateRequest } from '@rai/shared/schemas/pack';
import type { LaneQcRunResponse, VersionFindingsResponse } from '@rai/shared/schemas/review';
import type { SubmittedVersion } from '@rai/shared/schemas/versions';
import { openTestDatabase, type TestDatabase } from '../support/db.js';
import { RAI_WEB_ROOT, startTestServer, type TestServerProcess } from '../support/process.js';
import { FIXTURE_SIGN_IN_PATH, firstCookie } from '../support/sign-in.js';

const SET = fixtureSetLabel(readManifest());
const BLOB_DIR = path.join(RAI_WEB_ROOT, '.local', 'test', 'blobs'); // what tests/support/process.ts hands the server
const OWNER = 'fx-user-owner-cm';
const DPO = 'fx-user-dpo';
const IT_SECURITY = 'fx-user-it-security';
const MISSING_SLOT = findFixtureCase('fx-case-missing-slot')!; // CM, pre_build, non-vendor, slot 7 missing
const NONVENDOR = findFixtureCase('fx-case-nonvendor')!; // CM, pre_launch, non-vendor, slot 8 attached
const NA_REASONS = findFixtureCase('fx-case-na-reasons')!; // vendor, idea, slot 4 N/A with a reason

const SERVER_VERSION = (
  JSON.parse(readFileSync(new URL('../../server/package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

let db: TestDatabase;
let outputDir: string;
let server: TestServerProcess;

before(async () => {
  db = await openTestDatabase();
  outputDir = await mkdtemp(path.join(tmpdir(), 'rai-w4a-int-deterministic-'));
  await db.reset();
  await db.owner.execute(sql.raw('TRUNCATE TABLE "session", "registry_counter"'));
  await rm(path.join(BLOB_DIR, 'sha256'), { recursive: true, force: true });
  await loadFixtures(db.operator, { nodeEnv: 'test', identityMode: 'fixture', blobDir: BLOB_DIR, outputDir });
  server = await startTestServer({ env: { QC_MODE: 'deterministic' } });
});
after(async () => {
  await server?.stop();
  await db?.close();
  await rm(outputDir, { recursive: true, force: true });
});

async function signIn(fixtureUserId: string): Promise<string> {
  const res = await fetch(`${server.baseUrl}${FIXTURE_SIGN_IN_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ fixtureUserId }),
  });
  assert.equal(res.status, 200, await res.text());
  const cookie = firstCookie(res.headers.get('set-cookie') ?? undefined);
  assert.ok(cookie !== undefined, 'no session cookie');
  return cookie;
}

async function call<T>(
  cookie: string,
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; text: string; body: T; headers: Headers }> {
  const res = await fetch(`${server.baseUrl}${url}`, {
    method,
    headers: {
      cookie,
      'sec-fetch-site': 'same-origin',
      ...(body === undefined ? {} : { 'content-type': 'application/json', 'idempotency-key': randomUUID() }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    text,
    body: (text === '' ? undefined : JSON.parse(text)) as T,
    headers: res.headers,
  };
}

/** Save-draft (W1-04) then submit (W1-05) over HTTP; returns the new version and the submit correlation id. */
async function editAndSubmit(caseId: string, edit: Omit<PackDraftUpdateRequest, 'expectedVersion'> = {}) {
  const owner = await signIn(OWNER);
  let draft = (await call<PackDraft>(owner, 'GET', `/api/cases/${caseId}/draft`)).body;
  if (Object.keys(edit).length > 0) {
    const saved = await call<PackDraft>(owner, 'PUT', `/api/cases/${caseId}/draft`, {
      expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision },
      ...edit,
    } satisfies PackDraftUpdateRequest);
    assert.equal(saved.status, 200, saved.text);
    draft = saved.body;
  }
  const submitted = await call<SubmittedVersion>(owner, 'POST', `/api/cases/${caseId}/draft/submit`, {
    expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision },
  });
  assert.equal(submitted.status, 201, submitted.text);
  return {
    versionId: submitted.body.versionId,
    correlationId: String(submitted.headers.get('x-correlation-id')),
  };
}

async function runRows(versionId: string) {
  return (
    await db.owner.execute(
      sql`SELECT trigger, lane, engine_id, runner_version, status, rules_evaluated
            FROM qc_run WHERE version_id = ${versionId} ORDER BY requested_at, id`,
    )
  ).rows as Array<{
    trigger: string;
    lane: string | null;
    engine_id: string;
    runner_version: string;
    status: string;
    rules_evaluated: number | null;
  }>;
}

/** The submit trigger runs after the response (W0-07 3.2); wait for its row to leave `running`. */
async function settledSubmitRun(versionId: string) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const run = (await runRows(versionId)).find((r) => r.trigger === 'submit');
    if (run !== undefined && run.status !== 'running') return run;
    assert.ok(Date.now() < deadline, 'the submit run did not settle within 10 s');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function findings(cookie: string, caseId: string, versionId: string) {
  const res = await call<VersionFindingsResponse>(
    cookie,
    'GET',
    `/api/cases/${caseId}/versions/${versionId}/findings`,
  );
  assert.equal(res.status, 200, res.text);
  return res.body.findings.map((f) => ({ rule: f.ruleId, slot: f.slot, lane: f.owningLane }));
}

async function laneQc(cookie: string, caseId: string, versionId: string, lane: string) {
  const view = await call<CaseView>(cookie, 'GET', `/api/cases/${caseId}`);
  assert.equal(view.status, 200, view.text);
  const res = await call<LaneQcRunResponse>(
    cookie,
    'POST',
    `/api/cases/${caseId}/versions/${versionId}/lanes/${lane}/qc-run`,
    { expectedVersion: { versionId, revision: view.body.caseRevision } },
  );
  assert.equal(res.status, 200, res.text);
  return res.body;
}

describe(`W4a real server, QC_MODE=deterministic — ${SET}`, () => {
  it('readiness reports the deterministic runner as the bound QC kind', async () => {
    const res = await fetch(`${server.baseUrl}/readyz`, { signal: AbortSignal.timeout(10_000) });
    const report = (await res.json()) as ReadinessReport;
    assert.deepEqual(report.qc, { kind: 'deterministic', status: 'ok' });
  });

  it('submit: PACK-SLOT-MISSING on slot 7 for IT/Security; the run names the runner and its version and counts three rules', async () => {
    const target = await editAndSubmit(MISSING_SLOT.caseId, { slots: { 5: { state: 'missing' } } });
    const run = await settledSubmitRun(target.versionId);
    assert.deepEqual(
      [run.engine_id, run.runner_version, run.status, run.rules_evaluated],
      ['deterministic', SERVER_VERSION, 'completed', 3],
    );
    const owner = await signIn(OWNER);
    assert.deepEqual(
      await findings(owner, MISSING_SLOT.caseId, target.versionId),
      [{ rule: 'PACK-SLOT-MISSING', slot: 7, lane: 'it_security' }],
      'slot 5 has two lanes and raises nothing on submit',
    );
    const started = server.linesFor('qc.run.started').find((l) => l.correlationId === target.correlationId);
    assert.equal((started?.fields as Record<string, unknown> | undefined)?.qcKind, 'deterministic');

    // Two lanes on slot 5: each approve attempt raises one finding owned by the lane that ran it.
    const dpo = await laneQc(await signIn(DPO), MISSING_SLOT.caseId, target.versionId, 'dpo');
    const it = await laneQc(await signIn(IT_SECURITY), MISSING_SLOT.caseId, target.versionId, 'it_security');
    assert.deepEqual(
      [...dpo.findings, ...it.findings].map((f) => [f.ruleId, f.slot, f.owningLane]),
      [
        ['PACK-SLOT-MISSING', 5, 'dpo'],
        ['PACK-SLOT-MISSING', 5, 'it_security'],
      ],
    );
    assert.deepEqual(
      (await runRows(target.versionId)).map((r) => [r.trigger, r.lane, r.engine_id, r.rules_evaluated]),
      [
        ['submit', null, 'deterministic', 3],
        ['approve_attempt', 'dpo', 'deterministic', 1],
        ['approve_attempt', 'it_security', 'deterministic', 1],
      ],
    );
  });

  it('submit: PACK-STAGE-MISMATCH for AI/COE when slot 8 is attached at idea', async () => {
    const target = await editAndSubmit(NONVENDOR.caseId, { stageContext: 'idea' });
    assert.equal((await settledSubmitRun(target.versionId)).status, 'completed');
    assert.deepEqual(await findings(await signIn(OWNER), NONVENDOR.caseId, target.versionId), [
      { rule: 'PACK-STAGE-MISMATCH', slot: null, lane: 'ai_coe' },
    ]);
  });

  it('submit: PACK-NA-VENDOR-DOC for the DPO on a vendor case with slot 4 N/A', async () => {
    const target = await editAndSubmit(NA_REASONS.caseId);
    assert.equal((await settledSubmitRun(target.versionId)).status, 'completed');
    assert.deepEqual(await findings(await signIn(OWNER), NA_REASONS.caseId, target.versionId), [
      { rule: 'PACK-NA-VENDOR-DOC', slot: 4, lane: 'dpo' },
    ]);
  });
});
