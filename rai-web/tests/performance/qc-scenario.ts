import assert from 'node:assert/strict';
import type { QcRunner, QcRunResult } from '@rai/shared/qc/types';
import { ENGINE, expectedCase, proveCase, uuid, type LaunchConfig, type Query } from './server-contract.js';
export function scenario(config: LaunchConfig, query: Query) {
  const cases = new Map<string, number>(),
    keys = new Map<number, string>();
  let available = true;
  const runner: QcRunner & { probe(): Promise<'ok' | 'unavailable'> } = {
    identity: { runner: ENGINE, runnerVersion: '1' },
    probe: () => Promise.resolve(available ? 'ok' : 'unavailable'),
    run(request, signal): Promise<QcRunResult> {
      signal.throwIfAborted();
      const key = cases.get(request.version.caseId),
        at = new Date().toISOString();
      const supported =
        request.trigger === 'submit'
          ? request.lane === null
          : request.trigger === 'approve_attempt' &&
            ['ai_coe', 'dpo', 'it_security'].includes(request.lane ?? '');
      if (
        !available ||
        key === undefined ||
        !supported ||
        request.modelType !== 'llm' ||
        request.vendorInvolved !== false ||
        request.version.isDraft ||
        !uuid(request.version.versionId) ||
        !Number.isInteger(request.version.versionNumber) ||
        request.version.versionNumber < 1 ||
        request.version.versionNumber > expectedCase(config, key).maxVersion
      )
        return Promise.resolve({
          status: 'unavailable',
          reason: 'not_configured',
          detail: null,
          startedAt: at,
          finishedAt: at,
        });
      return Promise.resolve({
        status: 'completed',
        findings: [],
        rulesEvaluated: [],
        startedAt: at,
        finishedAt: at,
      });
    },
  };
  return {
    runner,
    ids: () => [...cases.keys()],
    close: () => {
      available = false;
    },
    async enroll(key: number, caseId: string) {
      assert(available && uuid(caseId));
      const expected = expectedCase(config, key);
      assert(!keys.has(key) || keys.get(key) === caseId, 'recipe already bound');
      assert(!cases.has(caseId) || cases.get(caseId) === key, 'case already bound');
      const rows = await query(
        'SELECT source_record_id, use_case_name, owner_subject_id, business_owner, business_unit_id, business_unit, technical_owner, created_by, vendor_involved, model_type FROM "case" WHERE id=$1',
        [caseId],
      );
      assert.equal(rows.length, 1);
      proveCase(expected, rows[0]);
      // Recheck after await: concurrent enrollment must not steal a recipe binding.
      assert(!keys.has(key) || keys.get(key) === caseId);
      assert(!cases.has(caseId) || cases.get(caseId) === key);
      assert(available);
      cases.set(caseId, key);
      keys.set(key, caseId);
    },
  };
}
