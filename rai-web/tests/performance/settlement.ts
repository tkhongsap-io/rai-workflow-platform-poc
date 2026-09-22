import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { ENGINE, uuid, type Query, type SubmitProof } from './server-contract.js';
export async function poll(check: () => Promise<boolean>, timeoutMs = 60_000) {
  const until = performance.now() + timeoutMs;
  do {
    if (await check()) return;
    await delay(100);
  } while (performance.now() < until);
  throw new Error('performance settlement deadline: committed QC/outbox evidence incomplete');
}
export function settlement(query: Query, ids: () => string[]) {
  async function qc(proof: SubmitProof) {
    assert(ids().includes(proof.caseId) && uuid(proof.versionId) && uuid(proof.correlationId));
    const audit = await query(
      "SELECT id FROM audit_event WHERE action='version.submitted' AND target_case_id=$1 AND target_version_id=$2 AND correlation_id=$3",
      [proof.caseId, proof.versionId, proof.correlationId],
    );
    assert.equal(audit.length, 1, 'missing original submission audit');
    const runs = await query(
      "SELECT q.status, q.engine_id, q.correlation_id, (SELECT count(*)::int FROM qc_finding f WHERE f.run_id=q.id) AS findings FROM qc_run q WHERE q.version_id=$1 AND q.trigger='submit' AND q.lane IS NULL",
      [proof.versionId],
    );
    if (!runs.length) return false;
    assert.equal(runs.length, 1);
    const run = runs[0]!;
    assert.equal(run.status, 'completed');
    assert.equal(run.engine_id, ENGINE);
    assert.equal(run.correlation_id, proof.correlationId);
    assert.equal(run.findings, 0);
    const notices = await query(
      "SELECT lane,status FROM notification WHERE case_id=$1 AND version_id=$2 AND correlation_id=$3 AND event='lane_open'",
      [proof.caseId, proof.versionId, proof.correlationId],
    );
    assert.deepEqual([...new Set(notices.map((n) => n.lane))].sort(), ['ai_coe', 'dpo', 'it_security']);
    assert(!notices.some((n) => n.status === 'failed'), 'terminal mail failure');
    return notices.every((n) => n.status === 'sent');
  }
  return {
    submit: (proof: SubmitProof) => poll(() => qc(proof)),
    settled: () =>
      poll(async () => {
        const all = ids();
        if (!all.length) return true;
        const submissions = await query(
          `SELECT a.target_version_id, count(q.id)::int AS runs,
        bool_and(q.status='completed' AND q.engine_id=$2 AND q.correlation_id=a.correlation_id
          AND f.id IS NULL) AS good
        FROM audit_event a LEFT JOIN qc_run q ON q.version_id=a.target_version_id AND q.trigger='submit' AND q.lane IS NULL LEFT JOIN qc_finding f ON f.run_id=q.id
        WHERE a.action='version.submitted' AND a.target_case_id=ANY($1::uuid[])
        GROUP BY a.id,a.target_version_id`,
          [all, ENGINE],
        );
        for (const row of submissions) {
          if (row.runs === 0) return false;
          assert.equal(row.runs, 1);
          assert.equal(row.good, true, 'non-clean submit outcome');
        }
        const states = await query(
          "SELECT status,count(*)::int AS count FROM notification WHERE case_id=ANY($1::uuid[]) OR event='sla_breach_digest' GROUP BY status",
          [all],
        );
        assert(!states.some((r) => r.status === 'failed'), 'terminal outbox failure');
        return !states.some((r) => r.status !== 'sent');
      }),
  };
}
