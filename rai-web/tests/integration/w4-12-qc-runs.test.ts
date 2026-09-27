// W4-12 (W4a plan section 7): the finding read shapes carry `evidence` (locators only) and
// GET …/versions/{versionId}/qc-runs lists a version's QC runs, authorized exactly like that version's findings read
// (W0-05 `version.view` on the case; 404 for an unknown, malformed or other-case version). Fixture app on the real
// Postgres with the W1-10 scripted substitute (its scripted findings carry evidence locators, one with an excerpt
// hash that must never be served). Fixture set slice1-synthetic@1; synthetic data only.

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { ErrorResponse } from '@rai/shared/errors';
import type { VersionRef } from '@rai/shared/qc/types';
import type { PackDraft, PackDraftUpdateRequest } from '@rai/shared/schemas/pack';
import type {
  LaneQcRunResponse,
  VersionFindingsResponse,
  VersionQcRunsResponse,
} from '@rai/shared/schemas/review';
import { FIXTURE_CASES, findFixtureCase } from '@rai/fixtures/data/cases/index';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import { ScriptedQcRunner } from '@rai/fixtures/substitutes/qc/index';
import { QC_SUBSTITUTE_RUNNER_VERSION } from '@rai/fixtures/substitutes/qc/version';
import { runAndPersistSubmitQc } from '@rai/server/qc/orchestrator';
import { assertNoLeak } from '../support/log-capture.js';
import {
  app,
  capture,
  caseRevision,
  db,
  diagnostics,
  openFixtureApp,
  signIn,
  submitOk,
} from '../support/fixture-app.js';
import { asUser, type FixtureSession } from '../support/sign-in.js';

const SET = fixtureSetLabel(readManifest());
const OWNER = 'fx-user-owner-cm'; // owns every fixture case
const OTHER_OWNER = 'fx-user-owner-cm-2'; // owns none
const SPOC_CM = 'fx-user-spoc-cm'; // BU SPOC of CM: another BU than the HR vendor case
const AI_COE = 'fx-user-ai-coe';
const DPO = 'fx-user-dpo';
const ADMIN = 'fx-user-admin';
const VENDOR = findFixtureCase('fx-case-vendor')!; // HR; scripted ai_coe findings with section and page locators
const NONVENDOR = findFixtureCase('fx-case-nonvendor')!; // CM
const EXCERPT_HASH = '0cb00095daeff1cf47996a236d9551eae358c081aeafc54d36039d7d592920fd'; // in fx-case-vendor.json

const fixtureCaseIdByRowId = new Map(FIXTURE_CASES.map((c) => [c.caseId, c.fixtureCaseId]));

const START = Date.parse('2026-09-27T06:00:00Z');
let clock = START;
const now = () => new Date((clock += 1000));

let runner: ScriptedQcRunner;
openFixtureApp({
  now,
  qcRunner: () =>
    (runner = new ScriptedQcRunner({
      fixtureCaseIdOf: (version: VersionRef) => fixtureCaseIdByRowId.get(version.caseId),
      now,
    })),
});

afterEach(() => {
  assertNoLeak(capture);
});

function get(session: FixtureSession | null, url: string) {
  return app.inject({ method: 'GET', url, headers: session === null ? {} : asUser(session) });
}

const runsUrl = (caseId: string, versionId: string) => `/api/cases/${caseId}/versions/${versionId}/qc-runs`;
const findingsUrl = (caseId: string, versionId: string) =>
  `/api/cases/${caseId}/versions/${versionId}/findings`;

async function laneQc(session: FixtureSession, caseId: string, versionId: string, lane: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/cases/${caseId}/versions/${versionId}/lanes/${lane}/qc-run`,
    headers: { 'content-type': 'application/json', ...asUser(session) },
    payload: { expectedVersion: { versionId, revision: await caseRevision(caseId) } },
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.json<LaneQcRunResponse>();
}

async function runCount(versionId: string): Promise<number> {
  const rows = await db.owner.execute(
    sql`SELECT count(*)::int AS n FROM qc_run WHERE version_id = ${versionId}`,
  );
  return Number((rows.rows[0] as { n: number }).n);
}

async function storedEvidence(versionId: string, ruleId: string) {
  const rows = await db.owner.execute(
    sql`SELECT evidence FROM qc_finding WHERE version_id = ${versionId} AND rule_id = ${ruleId}`,
  );
  return (rows.rows[0] as { evidence: Array<{ artifact_id: string | null }> }).evidence;
}

async function qcRulesLabelOf(revisionId: string): Promise<string | null> {
  const rows = await db.owner.execute(
    sql`SELECT body->>'label' AS label FROM configuration_revision WHERE id::text = ${revisionId} AND kind = 'qc_rules'`,
  );
  return (rows.rows[0] as { label: string } | undefined)?.label ?? null;
}

/** A vendor version with a completed submit run, a completed ai_coe run with findings and an unavailable dpo run. */
async function vendorWithThreeRuns() {
  const owner = await signIn(OWNER);
  const version = await submitOk(owner, VENDOR.caseId);
  const target = { caseId: VENDOR.caseId, versionId: version.versionId, correlationId: randomUUID() };
  const submitted = await runAndPersistSubmitQc({ db: db.app, runner, now, ...diagnostics }, target);
  assert.equal(submitted.status, 'completed');
  const ai = await laneQc(await signIn(AI_COE), VENDOR.caseId, version.versionId, 'ai_coe');
  assert.equal(ai.status, 'completed');
  runner.simulateError('runner_error');
  const dpo = await laneQc(await signIn(DPO), VENDOR.caseId, version.versionId, 'dpo');
  assert.equal(dpo.status, 'unavailable');
  return { owner, version, ai, dpo };
}

describe(`W4-12 qc-runs read and finding evidence — ${SET}`, () => {
  it('lists every run of the version in requested_at order with runner, revision, label, rules evaluated and finding count; the read writes nothing', async () => {
    const { owner, version, ai, dpo } = await vendorWithThreeRuns();
    const label = await qcRulesLabelOf(version.configurationRevisionId);
    assert.equal(label, 'w4a.1', 'the seed publishes qc_rules revision 1 (label w4a.1)');

    const before = await runCount(version.versionId);
    const res = await get(owner, runsUrl(VENDOR.caseId, version.versionId));
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(await runCount(version.versionId), before, 'GET must not insert a qc_run');
    const { runs } = res.json<VersionQcRunsResponse>();
    assert.equal(runs.length, 3);
    for (const run of runs) {
      assert.match(run.requestedAt, /^\d{4}-\d{2}-\d{2}T/);
      assert.match(run.completedAt, /^\d{4}-\d{2}-\d{2}T/);
    }
    const requested = runs.map((r) => Date.parse(r.requestedAt));
    assert.deepEqual(
      requested,
      [...requested].sort((a, b) => a - b),
    );
    const common = {
      runner: 'substitute-scripted',
      runnerVersion: QC_SUBSTITUTE_RUNNER_VERSION,
      ruleRevision: version.configurationRevisionId,
      rulesLabel: 'w4a.1',
      // W4-11b: the scripted substitute uses no extractor or model.
      extractorVersion: null,
      model: null,
      modelUsage: null,
    };
    assert.deepEqual(
      runs.map(({ requestedAt: _r, completedAt: _c, ...rest }) => rest),
      [
        {
          runId: runs[0]!.runId,
          trigger: 'submit',
          lane: null,
          slot: null,
          status: 'completed',
          unavailableReason: null,
          unavailableDetail: null,
          ...common,
          rulesEvaluated: 0,
          findingCount: 0,
        },
        {
          runId: ai.runId,
          trigger: 'approve_attempt',
          lane: 'ai_coe',
          slot: null,
          status: 'completed',
          unavailableReason: null,
          unavailableDetail: null,
          ...common,
          rulesEvaluated: 2,
          findingCount: 2,
        },
        {
          runId: dpo.runId,
          trigger: 'approve_attempt',
          lane: 'dpo',
          slot: null,
          status: 'unavailable',
          unavailableReason: 'runner_error',
          // W4-11b: the substitute's detail `simulated:runner_error` is outside ^[a-z0-9_]{1,64}$, so it is stored
          // as `unspecified` (plan section 7).
          unavailableDetail: 'unspecified',
          ...common,
          rulesEvaluated: 0,
          findingCount: 1,
        },
      ],
    );
  });

  it('a pre-W4a row reads unrecorded, a null rule count and a null label; a revision that is not qc_rules has no label', async () => {
    const owner = await signIn(OWNER);
    const version = await submitOk(owner, NONVENDOR.caseId);
    const legacy = (
      (
        await db.owner.execute(
          sql`SELECT id FROM configuration_revision WHERE kind = 'checklist_templates' LIMIT 1`,
        )
      ).rows[0] as { id: string }
    ).id;
    const at = new Date(START - 3_600_000);
    await db.owner.execute(
      sql`INSERT INTO qc_run (id, version_id, trigger, slot, lane, engine_id, runner_version, rule_revision, status,
                              unavailable_reason, rules_evaluated, requested_at, completed_at, correlation_id)
          VALUES (${randomUUID()}, ${version.versionId}, 'submit', NULL, NULL, 'substitute-scripted', 'unrecorded',
                  ${legacy}, 'completed', NULL, NULL, ${at}, ${at}, ${randomUUID()})`,
    );
    const res = await get(owner, runsUrl(NONVENDOR.caseId, version.versionId));
    assert.equal(res.statusCode, 200, res.body);
    const { runs } = res.json<VersionQcRunsResponse>();
    assert.equal(runs.length, 1);
    assert.deepEqual(
      {
        runnerVersion: runs[0]!.runnerVersion,
        ruleRevision: runs[0]!.ruleRevision,
        rulesLabel: runs[0]!.rulesLabel,
        rulesEvaluated: runs[0]!.rulesEvaluated,
        findingCount: runs[0]!.findingCount,
      },
      {
        runnerVersion: 'unrecorded',
        ruleRevision: legacy,
        rulesLabel: null,
        rulesEvaluated: null,
        findingCount: 0,
      },
    );
  });

  it('both finding shapes carry evidence as slot, artifact and locator, never an excerpt or content hash', async () => {
    const { owner, version, ai, dpo } = await vendorWithThreeRuns();
    const metricArtifact = (await storedEvidence(version.versionId, 'ACC-METRIC-CITED'))[0]!.artifact_id;
    const extractionArtifact = (
      await storedEvidence(version.versionId, 'ACC-EXTRACTION-NOT-HALLUCINATION')
    )[0]!.artifact_id;
    assert.ok(metricArtifact !== null && extractionArtifact !== null);
    const expected = {
      'ACC-METRIC-CITED': [
        {
          slot: 1,
          artifactId: metricArtifact,
          locator: { kind: 'section', heading: '4. Hallucination and accuracy' },
        },
      ],
      'ACC-EXTRACTION-NOT-HALLUCINATION': [
        { slot: 1, artifactId: extractionArtifact, locator: { kind: 'page', page: 3 } },
      ],
      'QC-UNAVAILABLE': [{ slot: null, artifactId: null, locator: { kind: 'absent' } }],
    } as const;

    // The lane qc-run response (StoredFindingSummary).
    assert.deepEqual(
      Object.fromEntries([...ai.findings, ...dpo.findings].map((f) => [f.ruleId, f.evidence])),
      expected,
    );

    // The findings read (FindingWithDisposition).
    const res = await get(owner, findingsUrl(VENDOR.caseId, version.versionId));
    assert.equal(res.statusCode, 200, res.body);
    const listed = res.json<VersionFindingsResponse>().findings;
    assert.deepEqual(Object.fromEntries(listed.map((f) => [f.ruleId, f.evidence])), expected);
    assert.ok(!res.body.includes(EXCERPT_HASH), 'the excerpt hash is never served');
    assert.ok(!/excerpt|content_?hash/i.test(res.body), 'no excerpt or content hash field');
  });

  it('scope: exactly the findings read — 401, 403 for another owner and another BU, 200 for reviewers and Admin, 404 for unknown, malformed and other-case versions', async () => {
    const owner = await signIn(OWNER);
    const version = await submitOk(owner, VENDOR.caseId); // HR
    const other = await submitOk(owner, NONVENDOR.caseId); // CM
    const sessions: Array<[string, FixtureSession | null]> = [
      ['anonymous', null],
      [OWNER, owner],
      [OTHER_OWNER, await signIn(OTHER_OWNER)],
      [SPOC_CM, await signIn(SPOC_CM)],
      [AI_COE, await signIn(AI_COE)],
      [ADMIN, await signIn(ADMIN)],
      ['fx-user-dpo-spoc-hr', await signIn('fx-user-dpo-spoc-hr')],
    ];
    const targets: Array<[string, string, string]> = [
      ['the version', VENDOR.caseId, version.versionId],
      ['an unknown version', VENDOR.caseId, randomUUID()],
      ['a malformed version id', VENDOR.caseId, 'not-a-uuid'],
      ["another case's version", VENDOR.caseId, other.versionId],
      ['an unknown case', randomUUID(), version.versionId],
    ];
    const seen: Record<string, number> = {};
    for (const [who, session] of sessions) {
      for (const [what, caseId, versionId] of targets) {
        const runs = await get(session, runsUrl(caseId, versionId));
        const findings = await get(session, findingsUrl(caseId, versionId));
        assert.equal(runs.statusCode, findings.statusCode, `${who} on ${what}: ${runs.body}`);
        if (runs.statusCode !== 200)
          assert.equal(
            runs.json<ErrorResponse>().error.code,
            findings.json<ErrorResponse>().error.code,
            `${who} on ${what}`,
          );
        seen[`${who} ${what}`] = runs.statusCode;
      }
    }
    assert.deepEqual(
      {
        anonymous: seen['anonymous the version'],
        owner: seen[`${OWNER} the version`],
        otherOwner: seen[`${OTHER_OWNER} the version`],
        otherBu: seen[`${SPOC_CM} the version`],
        reviewer: seen[`${AI_COE} the version`],
        admin: seen[`${ADMIN} the version`],
        dualRole: seen['fx-user-dpo-spoc-hr the version'],
        unknown: seen[`${OWNER} an unknown version`],
        malformed: seen[`${OWNER} a malformed version id`],
        otherCase: seen[`${OWNER} another case's version`],
        unknownCaseReviewer: seen[`${AI_COE} an unknown case`],
      },
      {
        anonymous: 401,
        owner: 200,
        otherOwner: 403,
        otherBu: 403,
        reviewer: 200,
        admin: 200,
        dualRole: 200,
        unknown: 404,
        malformed: 404,
        otherCase: 404,
        unknownCaseReviewer: 404,
      },
    );
  });

  it("a draft's upload run is listed on the draft for whoever may read the draft's findings, a reviewer included", async () => {
    const owner = await signIn(OWNER);
    const draftRes = await get(owner, `/api/cases/${NONVENDOR.caseId}/draft`);
    assert.equal(draftRes.statusCode, 200, draftRes.body);
    const draft = draftRes.json<PackDraft>();
    const slot2 = draft.slots[2];
    assert.equal(slot2?.state, 'attached');
    const saved = await app.inject({
      method: 'PUT',
      url: `/api/cases/${NONVENDOR.caseId}/draft`,
      headers: { 'content-type': 'application/json', ...asUser(owner) },
      payload: {
        expectedVersion: { versionId: draft.draftId, revision: draft.draftRevision },
        slots: { 1: { state: 'attached', artifactId: (slot2 as { artifactId: string }).artifactId } },
      } satisfies PackDraftUpdateRequest,
    });
    assert.equal(saved.statusCode, 200, saved.body);
    // The upload run lands after the save's response (W4-04).
    const deadline = Date.now() + 5000;
    while ((await runCount(draft.draftId)) < 1) {
      assert.ok(Date.now() < deadline, 'the upload run did not land within 5 s');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const res = await get(owner, runsUrl(NONVENDOR.caseId, draft.draftId));
    assert.equal(res.statusCode, 200, res.body);
    const { runs } = res.json<VersionQcRunsResponse>();
    assert.deepEqual(
      runs.map((r) => [r.trigger, r.slot, r.lane, r.status, r.rulesEvaluated, r.findingCount, r.rulesLabel]),
      [['upload', 1, null, 'completed', 0, 0, 'w4a.1']],
    );

    for (const who of [SPOC_CM, AI_COE, OTHER_OWNER]) {
      const session = await signIn(who);
      const runsRes = await get(session, runsUrl(NONVENDOR.caseId, draft.draftId));
      const findingsRes = await get(session, findingsUrl(NONVENDOR.caseId, draft.draftId));
      assert.equal(runsRes.statusCode, findingsRes.statusCode, `${who}: ${runsRes.body}`);
      assert.equal(runsRes.statusCode, who === OTHER_OWNER ? 403 : 200, who);
    }
  });
});
