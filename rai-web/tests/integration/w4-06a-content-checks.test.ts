// W4-06a (W4b plan sections 3.1 and 6; decision 30): the orchestrator's `checkedResult` applies the new checks to every
// runner before anything is recorded. Two findings of one run with one `findingKey` fail the whole run
// (`duplicate_finding_key`); a string message param that could be document text fails it (`message_param_text`); evidence
// citing an artifact the request did not carry fails it (`evidence_outside_request`). Two defective claims in one
// artifact, told apart by their claim keys, are two stored findings. Synthetic probe runners over the fixture set
// slice1-synthetic@1; no document byte is read.

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import type { QcFinding, QcRunRequest, QcRunResult, QcRunner } from '@rai/shared/qc/types';
import { findingKeyOf } from '@rai/shared/qc/validate';
import { runAndPersistSubmitQc } from '@rai/server/qc/orchestrator';
import { assertNoLeak } from '../support/log-capture.js';
import { capture, db, diagnostics, openFixtureApp, signIn, submit } from '../support/fixture-app.js';

const OWNER_A = 'fx-user-owner-cm';
const VENDOR = findFixtureCase('fx-case-vendor')!;

let clock = Date.parse('2026-09-27T09:00:00Z');
const now = () => new Date((clock += 1000));

openFixtureApp({ now });

afterEach(() => {
  assertNoLeak(capture);
});

/** A runner that answers from the request it was given, so its findings can cite the request's own artifacts. */
function probe(findingsOf: (request: QcRunRequest) => QcFinding[]): QcRunner {
  return {
    identity: { runner: 'content-probe', runnerVersion: '0.0.0' },
    run(request): Promise<QcRunResult> {
      const at = new Date(clock).toISOString();
      return Promise.resolve({
        status: 'completed',
        findings: findingsOf(request),
        rulesEvaluated: ['ACC-METRIC-CITED'],
        startedAt: at,
        finishedAt: at,
      });
    },
  };
}

/** An ACC-METRIC-CITED finding on the request's slot-1 artifact, for one claim. */
function claimFinding(
  request: QcRunRequest,
  claimKey: string,
  params: Record<string, string | number> = {},
): QcFinding {
  const artifact = request.artifacts.find((a) => a.slot === 1)!;
  const scope = {
    kind: 'artifact' as const,
    slot: 1 as const,
    artifactId: artifact.artifactId,
    contentHash: artifact.contentHash,
  };
  return {
    findingKey: findingKeyOf('ACC-METRIC-CITED', scope, claimKey),
    ruleId: 'ACC-METRIC-CITED',
    ruleRevision: request.qcRulesRevision,
    trigger: request.trigger,
    scope,
    claimKey,
    severity: 'medium',
    owningLane: 'ai_coe',
    evidence: [
      {
        artifactId: artifact.artifactId,
        contentHash: artifact.contentHash,
        slot: 1,
        locator: { kind: 'section', index: 4 },
        excerptHash: `${claimKey}${'0'.repeat(64 - claimKey.length)}`,
      },
    ],
    measure: null,
    message: { key: 'qc.finding.acc_metric_cited', params: { slot: 1, missing: 'threshold', ...params } },
    provenance: { runner: 'content-probe', runnerVersion: '0.0.0' },
  };
}

async function submitVendor() {
  const owner = await signIn(OWNER_A);
  const { version, correlationId } = await submit(owner, VENDOR.caseId);
  return {
    versionId: version.versionId,
    input: { caseId: VENDOR.caseId, versionId: version.versionId, correlationId },
  };
}

async function runRow(runId: string) {
  const rows = await db.owner.execute(
    sql`SELECT status, unavailable_reason, unavailable_detail FROM qc_run WHERE id = ${runId}`,
  );
  return rows.rows[0] as {
    status: string;
    unavailable_reason: string | null;
    unavailable_detail: string | null;
  };
}

async function defectCount(runId: string): Promise<number> {
  const rows = await db.owner.execute(
    sql`SELECT count(*)::int AS n FROM qc_finding WHERE run_id = ${runId} AND kind = 'defect'`,
  );
  return (rows.rows[0] as { n: number }).n;
}

describe('W4-06a: the orchestrator checks content findings before recording them', () => {
  it('two defective claims in one artifact are two stored findings', async () => {
    const { input } = await submitVendor();
    const runner = probe((request) => [
      claimFinding(request, '0123456789abcdef', { item: '2.1' }),
      claimFinding(request, 'fedcba9876543210', { item: '2.2' }),
    ]);
    const outcome = await runAndPersistSubmitQc({ db: db.app, runner, now, ...diagnostics }, input);
    assert.equal(outcome.status, 'completed');
    assert.equal(outcome.findings.length, 2);
    assert.equal(await defectCount(outcome.runId), 2);
  });

  const refusals: Array<[string, (request: QcRunRequest) => QcFinding[], string]> = [
    [
      'two findings with one findingKey',
      (request) => [claimFinding(request, '0123456789abcdef'), claimFinding(request, '0123456789abcdef')],
      'duplicate_finding_key',
    ],
    [
      'a message param that could be document text',
      (request) => [claimFinding(request, '0123456789abcdef', { note: 'The model reached 97.5% accuracy' })],
      'message_param_text',
    ],
    [
      'evidence citing an artifact the request did not carry',
      (request) => {
        const finding = claimFinding(request, '0123456789abcdef');
        finding.evidence[0]!.artifactId = '00000000-0000-7000-8000-00000000dead';
        return [finding];
      },
      'evidence_outside_request',
    ],
  ];
  for (const [name, findings, detail] of refusals)
    it(`${name} fails the whole run as runner_error / ${detail}; no defect is stored`, async () => {
      const { input } = await submitVendor();
      const outcome = await runAndPersistSubmitQc(
        { db: db.app, runner: probe(findings), now, ...diagnostics },
        input,
      );
      assert.equal(outcome.status, 'unavailable');
      assert.equal(outcome.reason, 'runner_error');
      assert.deepEqual(await runRow(outcome.runId), {
        status: 'unavailable',
        unavailable_reason: 'runner_error',
        unavailable_detail: detail,
      });
      assert.equal(await defectCount(outcome.runId), 0);
    });
});
