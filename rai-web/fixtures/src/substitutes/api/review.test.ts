// W2-10: substitute coverage for W0-02 §7.7 shapes — approve, send-back, qc-run, disposition — including
// success, forbidden (wrong lane / Admin / owner·SPOC self-exclusion), stale_version, and 422 (missing
// feedback / reason / idempotency key). History stays the existing version read. Not the W2 exit.

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { CaseView } from '@rai/shared/schemas/cases';
import type {
  DispositionResponse,
  LaneDecisionResponse,
  LaneQcRunResponse,
} from '@rai/shared/schemas/review';
import type { SubmittedVersion } from '@rai/shared/schemas/versions';
import { findFixtureCase } from '../../data/cases/index.js';
import { createApiSubstitute, type ApiSubstitute } from './handler.js';
import { call, signIn, type CallResult } from './testing.js';

interface Envelope {
  error: {
    code: string;
    messageKey: string;
    correlationId: string;
    details?: { reason?: string; fields?: unknown; [key: string]: unknown };
  };
}

function staleReason(response: CallResult): string | undefined {
  return response.json<Envelope>().error.details?.reason;
}

const nonvendor = findFixtureCase('fx-case-nonvendor')!;
const vendor = findFixtureCase('fx-case-vendor')!;

describe('W2-10 substitute: W2 shapes (approve, send-back, qc-run, disposition)', () => {
  let substitute: ApiSubstitute;
  const users: Record<string, string> = {};

  beforeEach(async () => {
    substitute = createApiSubstitute({
      now: () => new Date('2026-09-22T12:00:00Z'),
      qcTimeoutMs: 50,
    });
    for (const id of [
      'fx-user-owner-cm',
      'fx-user-spoc-cm',
      'fx-user-ai-coe',
      'fx-user-dpo',
      'fx-user-it-security',
      'fx-user-admin',
    ])
      users[id] = await signIn(substitute, id);
  });

  async function submit(fixture = nonvendor): Promise<SubmittedVersion> {
    const response = await call(substitute, 'POST', `/api/cases/${fixture.caseId}/draft/submit`, {
      cookie: users['fx-user-owner-cm'],
      headers: { 'idempotency-key': randomUUID() },
      json: { expectedVersion: { versionId: fixture.draftVersionId, revision: 1 } },
    });
    assert.equal(response.status, 201, response.text());
    return response.json<SubmittedVersion>();
  }

  const approve = (
    user: string,
    caseId: string,
    versionId: string,
    lane: string,
    body: unknown,
    key: string | null = randomUUID(),
  ): Promise<CallResult> =>
    call(substitute, 'POST', `/api/cases/${caseId}/versions/${versionId}/lanes/${lane}/approve`, {
      cookie: users[user],
      headers: key === null ? {} : { 'idempotency-key': key },
      json: body,
    });

  const sendBack = (
    user: string,
    caseId: string,
    versionId: string,
    lane: string,
    body: unknown,
    key: string | null = randomUUID(),
  ): Promise<CallResult> =>
    call(substitute, 'POST', `/api/cases/${caseId}/versions/${versionId}/lanes/${lane}/send-back`, {
      cookie: users[user],
      headers: key === null ? {} : { 'idempotency-key': key },
      json: body,
    });

  const qcRun = (
    user: string,
    caseId: string,
    versionId: string,
    lane: string,
    body: unknown,
  ): Promise<CallResult> =>
    call(substitute, 'POST', `/api/cases/${caseId}/versions/${versionId}/lanes/${lane}/qc-run`, {
      cookie: users[user],
      json: body,
    });

  const disposition = (
    user: string,
    caseId: string,
    findingId: string,
    body: unknown,
    key: string | null = randomUUID(),
  ): Promise<CallResult> =>
    call(substitute, 'POST', `/api/cases/${caseId}/findings/${findingId}/dispositions`, {
      cookie: users[user],
      headers: key === null ? {} : { 'idempotency-key': key },
      json: body,
    });

  describe('approve', () => {
    it('own-lane approve returns 201 with ready false until three lanes approve', async () => {
      const version = await submit();
      const response = await approve('fx-user-dpo', nonvendor.caseId, version.versionId, 'dpo', {
        expectedVersion: { versionId: version.versionId, revision: 1 },
        qcRunId: randomUUID(),
      });
      assert.equal(response.status, 201, response.text());
      const body = response.json<LaneDecisionResponse>();
      assert.equal(body.decision, 'approve');
      assert.equal(body.lane, 'dpo');
      assert.equal(body.successorDraftVersionId, null);
      assert.equal(body.ready, false);
      assert.equal(body.caseRevision, 1);
      const view = (
        await call(substitute, 'GET', `/api/cases/${nonvendor.caseId}`, { cookie: users['fx-user-dpo'] })
      ).json<CaseView>();
      assert.equal(view.privacyStatus, 'approved');
      assert.equal(view.securityStatus, 'pending');
    });

    it('Admin, owner, SPOC and wrong-lane are 403', async () => {
      const version = await submit();
      const payload = {
        expectedVersion: { versionId: version.versionId, revision: 1 },
        qcRunId: randomUUID(),
      };
      for (const [user, lane] of [
        ['fx-user-admin', 'dpo'],
        ['fx-user-owner-cm', 'dpo'],
        ['fx-user-spoc-cm', 'dpo'],
        ['fx-user-dpo', 'ai_coe'],
      ] as const) {
        const response = await approve(user, nonvendor.caseId, version.versionId, lane, payload);
        assert.equal(response.status, 403, `${user}/${lane}: ${response.text()}`);
        assert.equal(response.json<Envelope>().error.code, 'forbidden');
      }
    });

    it('unknown expected version is 404; successor draft closes approve with 409 stale_version and no write', async () => {
      const version = await submit();
      const unknown = await approve('fx-user-dpo', nonvendor.caseId, randomUUID(), 'dpo', {
        expectedVersion: { versionId: randomUUID(), revision: 1 },
        qcRunId: randomUUID(),
      });
      // path and body disagree → 422; align them on a non-existent id → 404 after authz
      const missingId = randomUUID();
      const missing = await approve('fx-user-dpo', nonvendor.caseId, missingId, 'dpo', {
        expectedVersion: { versionId: missingId, revision: 1 },
        qcRunId: randomUUID(),
      });
      assert.equal(missing.status, 404, missing.text());
      void unknown;

      const sb = await sendBack('fx-user-dpo', nonvendor.caseId, version.versionId, 'dpo', {
        expectedVersion: { versionId: version.versionId, revision: 1 },
        feedback: { items: [{ slot: 1, deficiency: 'needs metric citation' }] },
      });
      assert.equal(sb.status, 201, sb.text());
      const decisionsBefore = substitute.store.decisions.size;
      const response = await approve('fx-user-ai-coe', nonvendor.caseId, version.versionId, 'ai_coe', {
        expectedVersion: { versionId: version.versionId, revision: 1 },
        qcRunId: randomUUID(),
      });
      assert.equal(response.status, 409, response.text());
      assert.equal(response.json<Envelope>().error.code, 'stale_version');
      assert.equal(staleReason(response), 'version_closed');
      assert.equal(substitute.store.decisions.size, decisionsBefore);
    });

    it('expected version closed by Ready is 409 stale_version', async () => {
      const version = await submit();
      for (const [user, lane] of [
        ['fx-user-dpo', 'dpo'],
        ['fx-user-ai-coe', 'ai_coe'],
        ['fx-user-it-security', 'it_security'],
      ] as const) {
        assert.equal(
          (
            await approve(user, nonvendor.caseId, version.versionId, lane, {
              expectedVersion: { versionId: version.versionId, revision: 1 },
              qcRunId: randomUUID(),
            })
          ).status,
          201,
        );
      }
      const again = await approve('fx-user-dpo', nonvendor.caseId, version.versionId, 'dpo', {
        expectedVersion: { versionId: version.versionId, revision: 1 },
        qcRunId: randomUUID(),
      });
      // Ready closes mutating approve as version_closed (checked before lane_already_decided).
      assert.equal(again.status, 409, again.text());
      assert.equal(again.json<Envelope>().error.code, 'stale_version');
      assert.equal(staleReason(again), 'version_closed');
    });

    it('missing idempotency key is 422; replay of the same key returns the original body', async () => {
      const version = await submit();
      const missing = await approve(
        'fx-user-dpo',
        nonvendor.caseId,
        version.versionId,
        'dpo',
        {
          expectedVersion: { versionId: version.versionId, revision: 1 },
          qcRunId: randomUUID(),
        },
        null,
      );
      assert.equal(missing.status, 422, missing.text());
      assert.equal(missing.json<Envelope>().error.code, 'invalid_input');

      const key = randomUUID();
      const payload = {
        expectedVersion: { versionId: version.versionId, revision: 1 },
        qcRunId: randomUUID(),
      };
      const first = await approve(
        'fx-user-it-security',
        nonvendor.caseId,
        version.versionId,
        'it_security',
        payload,
        key,
      );
      assert.equal(first.status, 201, first.text());
      const replay = await approve(
        'fx-user-it-security',
        nonvendor.caseId,
        version.versionId,
        'it_security',
        payload,
        key,
      );
      assert.equal(replay.status, 201);
      assert.equal(replay.text(), first.text());
      assert.equal(substitute.store.decisions.size, 1);
    });

    it('three current-version approvals with no findings set ready true on the last approve', async () => {
      const version = await submit();
      const payload = () => ({
        expectedVersion: { versionId: version.versionId, revision: 1 },
        qcRunId: randomUUID(),
      });
      assert.equal(
        (await approve('fx-user-dpo', nonvendor.caseId, version.versionId, 'dpo', payload())).status,
        201,
      );
      assert.equal(
        (
          await approve('fx-user-ai-coe', nonvendor.caseId, version.versionId, 'ai_coe', payload())
        ).json<LaneDecisionResponse>().ready,
        false,
      );
      const last = await approve(
        'fx-user-it-security',
        nonvendor.caseId,
        version.versionId,
        'it_security',
        payload(),
      );
      assert.equal(last.status, 201, last.text());
      assert.equal(last.json<LaneDecisionResponse>().ready, true);
      const view = (
        await call(substitute, 'GET', `/api/cases/${nonvendor.caseId}`, {
          cookie: users['fx-user-owner-cm'],
        })
      ).json<CaseView>();
      assert.equal(view.status, 'ready_for_launch');
      assert.equal(view.aiReadinessStatus, 'ready');
    });
  });

  describe('send-back', () => {
    it('creates one N+1 draft; a second send-back reuses it; version N stays unchanged', async () => {
      const version = await submit();
      const before = structuredClone(version);
      const first = await sendBack('fx-user-dpo', nonvendor.caseId, version.versionId, 'dpo', {
        expectedVersion: { versionId: version.versionId, revision: 1 },
        feedback: { items: [{ slot: 2, deficiency: 'PII inventory incomplete' }] },
      });
      assert.equal(first.status, 201, first.text());
      const body1 = first.json<LaneDecisionResponse>();
      assert.equal(body1.decision, 'send_back');
      assert.ok(body1.successorDraftVersionId);
      assert.equal(body1.ready, false);

      const second = await sendBack('fx-user-ai-coe', nonvendor.caseId, version.versionId, 'ai_coe', {
        expectedVersion: { versionId: version.versionId, revision: 1 },
        feedback: { items: [{ slot: 1, deficiency: 'accuracy section missing' }] },
      });
      assert.equal(second.status, 201, second.text());
      assert.equal(
        second.json<LaneDecisionResponse>().successorDraftVersionId,
        body1.successorDraftVersionId,
      );

      const reread = await call(
        substitute,
        'GET',
        `/api/cases/${nonvendor.caseId}/versions/${version.versionId}`,
        { cookie: users['fx-user-owner-cm'] },
      );
      assert.equal(reread.status, 200);
      assert.deepEqual(reread.json<SubmittedVersion>(), before);

      const view = (
        await call(substitute, 'GET', `/api/cases/${nonvendor.caseId}`, {
          cookie: users['fx-user-owner-cm'],
        })
      ).json<CaseView>();
      assert.equal(view.status, 'sent_back');
      assert.equal(view.draft?.draftId, body1.successorDraftVersionId);
      assert.equal(view.draft?.versionNumber, 2);
    });

    it('feedback without a named slot is 422; Admin is 403; stale version is 409', async () => {
      const version = await submit();
      const empty = await sendBack('fx-user-dpo', nonvendor.caseId, version.versionId, 'dpo', {
        expectedVersion: { versionId: version.versionId, revision: 1 },
        feedback: { items: [] },
      });
      assert.equal(empty.status, 422, empty.text());
      assert.equal(empty.json<Envelope>().error.code, 'invalid_input');

      const admin = await sendBack('fx-user-admin', nonvendor.caseId, version.versionId, 'dpo', {
        expectedVersion: { versionId: version.versionId, revision: 1 },
        feedback: { items: [{ slot: 1, deficiency: 'x' }] },
      });
      assert.equal(admin.status, 403);

      // After send-back, a second decision on the same lane is lane_already_decided.
      const first = await sendBack('fx-user-dpo', nonvendor.caseId, version.versionId, 'dpo', {
        expectedVersion: { versionId: version.versionId, revision: 1 },
        feedback: { items: [{ slot: 1, deficiency: 'x' }] },
      });
      assert.equal(first.status, 201, first.text());
      const again = await sendBack('fx-user-dpo', nonvendor.caseId, version.versionId, 'dpo', {
        expectedVersion: { versionId: version.versionId, revision: 1 },
        feedback: { items: [{ slot: 1, deficiency: 'y' }] },
      });
      assert.equal(again.status, 409, again.text());
      assert.equal(again.json<Envelope>().error.code, 'stale_version');
      assert.equal(staleReason(again), 'lane_already_decided');
    });
  });

  describe('qc-run', () => {
    it('returns scripted single-lane findings for fx-case-vendor ai_coe', async () => {
      const version = await submit(vendor);
      const response = await qcRun('fx-user-ai-coe', vendor.caseId, version.versionId, 'ai_coe', {
        expectedVersion: { versionId: version.versionId, revision: 1 },
      });
      assert.equal(response.status, 200, response.text());
      const body = response.json<LaneQcRunResponse>();
      assert.equal(body.status, 'completed');
      assert.ok(body.runId);
      assert.ok(body.findings.length >= 1);
      for (const finding of body.findings) {
        assert.equal(finding.owningLane, 'ai_coe');
        assert.notEqual(finding.slot, 5);
        assert.notEqual(finding.slot, 9);
        assert.ok(substitute.store.findings.has(finding.findingId));
      }
    });

    it('unavailable runner_error re-runs; hang becomes timeout; wrong lane 403; Ready is version_closed', async () => {
      const version = await submit(vendor);
      assert.ok(substitute.store.qcRunner);
      substitute.store.qcRunner.simulateError('runner_error');
      const unavailable = await qcRun('fx-user-dpo', vendor.caseId, version.versionId, 'dpo', {
        expectedVersion: { versionId: version.versionId, revision: 1 },
      });
      assert.equal(unavailable.status, 200, unavailable.text());
      const body = unavailable.json<LaneQcRunResponse>();
      assert.equal(body.status, 'unavailable');
      assert.equal(body.reason, 'runner_error');
      assert.ok(body.runId);
      assert.deepEqual(body.findings, []);
      assert.equal([...substitute.store.findings.values()].filter((f) => f.runId === body.runId).length, 0);

      // runner_error is not permanently cached: next call (no simulation) can complete.
      const retry = await qcRun('fx-user-dpo', vendor.caseId, version.versionId, 'dpo', {
        expectedVersion: { versionId: version.versionId, revision: 1 },
      });
      assert.equal(retry.status, 200, retry.text());
      assert.equal(retry.json<LaneQcRunResponse>().status, 'completed');

      // Simulated hang is aborted by the route timeout → unavailable:timeout, not pending.
      const runner = substitute.store.qcRunner;
      assert.ok(runner);
      runner.simulateTimeout('hang');
      const hung = await qcRun('fx-user-ai-coe', vendor.caseId, version.versionId, 'ai_coe', {
        expectedVersion: { versionId: version.versionId, revision: 1 },
      });
      assert.equal(hung.status, 200, hung.text());
      const hungBody = hung.json<LaneQcRunResponse>();
      assert.equal(hungBody.status, 'unavailable');
      assert.equal(hungBody.reason, 'timeout');
      assert.deepEqual(hungBody.findings, []);

      // After the hang simulation is consumed, a later call can return completed.
      const afterHang = await qcRun('fx-user-ai-coe', vendor.caseId, version.versionId, 'ai_coe', {
        expectedVersion: { versionId: version.versionId, revision: 1 },
      });
      assert.equal(afterHang.status, 200, afterHang.text());
      assert.equal(afterHang.json<LaneQcRunResponse>().status, 'completed');
      assert.ok(afterHang.json<LaneQcRunResponse>().findings.length >= 1);

      const wrong = await qcRun('fx-user-dpo', vendor.caseId, version.versionId, 'ai_coe', {
        expectedVersion: { versionId: version.versionId, revision: 1 },
      });
      assert.equal(wrong.status, 403);

      // Ready closes qc-run as version_closed.
      const clean = await submit();
      for (const [user, lane] of [
        ['fx-user-dpo', 'dpo'],
        ['fx-user-ai-coe', 'ai_coe'],
        ['fx-user-it-security', 'it_security'],
      ] as const) {
        assert.equal(
          (
            await approve(user, nonvendor.caseId, clean.versionId, lane, {
              expectedVersion: { versionId: clean.versionId, revision: 1 },
              qcRunId: randomUUID(),
            })
          ).status,
          201,
        );
      }
      const closed = await qcRun('fx-user-dpo', nonvendor.caseId, clean.versionId, 'dpo', {
        expectedVersion: { versionId: clean.versionId, revision: 1 },
      });
      assert.equal(closed.status, 409, closed.text());
      assert.equal(closed.json<Envelope>().error.code, 'stale_version');
      assert.equal(staleReason(closed), 'version_closed');
    });
  });

  describe('disposition', () => {
    async function findingOnVendor(): Promise<{ version: SubmittedVersion; findingId: string }> {
      const version = await submit(vendor);
      const run = await qcRun('fx-user-ai-coe', vendor.caseId, version.versionId, 'ai_coe', {
        expectedVersion: { versionId: version.versionId, revision: 1 },
      });
      assert.equal(run.status, 200, run.text());
      const findingId = run.json<LaneQcRunResponse>().findings[0]!.findingId;
      return { version, findingId };
    }

    it('authorize before reason: unauthorized waived without reason is 403; own-lane waived without reason is 422', async () => {
      const { version, findingId } = await findingOnVendor();
      const unauthorized = await disposition('fx-user-dpo', vendor.caseId, findingId, {
        expectedVersion: { versionId: version.versionId, revision: 1 },
        kind: 'waived',
      });
      assert.equal(unauthorized.status, 403, unauthorized.text());
      assert.equal(unauthorized.json<Envelope>().error.code, 'forbidden');

      const noReason = await disposition('fx-user-ai-coe', vendor.caseId, findingId, {
        expectedVersion: { versionId: version.versionId, revision: 1 },
        kind: 'waived',
      });
      assert.equal(noReason.status, 422, noReason.text());
      assert.equal(noReason.json<Envelope>().error.code, 'invalid_input');

      const wrongLane = await disposition('fx-user-dpo', vendor.caseId, findingId, {
        expectedVersion: { versionId: version.versionId, revision: 1 },
        kind: 'waived',
        reason: 'out of scope for privacy',
      });
      assert.equal(wrongLane.status, 403, wrongLane.text());

      const proposed = await disposition('fx-user-owner-cm', vendor.caseId, findingId, {
        expectedVersion: { versionId: version.versionId, revision: 1 },
        kind: 'fixed_proposed',
      });
      assert.equal(proposed.status, 201, proposed.text());
      assert.equal(proposed.json<DispositionResponse>().kind, 'fixed_proposed');
      const latest = substitute.store.dispositions.get(findingId)!.at(-1)!;
      assert.equal(latest.kind, 'fixed_proposed');
      // Finding object unchanged.
      const frozen = structuredClone(substitute.store.findings.get(findingId)!);

      const confirmed = await disposition('fx-user-ai-coe', vendor.caseId, findingId, {
        expectedVersion: { versionId: version.versionId, revision: 1 },
        kind: 'fixed_confirmed',
      });
      assert.equal(confirmed.status, 201, confirmed.text());
      assert.equal(substitute.store.dispositions.get(findingId)!.length, 2);
      assert.deepEqual(substitute.store.findings.get(findingId), frozen);
    });

    it('an unknown finding is 404 for every lane reviewer and 403 role for Admin', async () => {
      const version = await submit(vendor);
      const body = {
        expectedVersion: { versionId: version.versionId, revision: 1 },
        kind: 'waived',
        reason: 'synthetic',
      };
      const denials = () => substitute.store.logLines.filter((l) => l.event === 'authz.denied');
      for (const reviewer of ['fx-user-dpo', 'fx-user-it-security', 'fx-user-ai-coe']) {
        const response = await disposition(reviewer, vendor.caseId, randomUUID(), body);
        assert.equal(response.status, 404, `${reviewer}: ${response.text()}`);
        assert.equal(response.json<Envelope>().error.code, 'not_found');
        assert.deepEqual(response.json<Envelope>().error.details, { resource: 'finding' });
      }
      assert.equal(denials().length, 0, 'no authz.denied line');

      const admin = await disposition('fx-user-admin', vendor.caseId, randomUUID(), body);
      assert.equal(admin.status, 403, admin.text());
      assert.equal(denials().at(-1)?.fields.reason, 'role');
    });

    it('stale expected version is 409 version_superseded and appends nothing', async () => {
      const { findingId } = await findingOnVendor();
      const before = (substitute.store.dispositions.get(findingId) ?? []).length;
      const response = await disposition('fx-user-ai-coe', vendor.caseId, findingId, {
        expectedVersion: { versionId: randomUUID(), revision: 1 },
        kind: 'fixed',
      });
      assert.equal(response.status, 409, response.text());
      assert.equal(response.json<Envelope>().error.code, 'stale_version');
      assert.equal(staleReason(response), 'version_superseded');
      assert.equal((substitute.store.dispositions.get(findingId) ?? []).length, before);
    });
  });
});
