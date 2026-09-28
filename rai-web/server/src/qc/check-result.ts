// W4-08a (W4b plan section 11.2): the QC orchestrator's result boundary, moved unchanged out of `orchestrator.ts` so
// the evaluation harness (`tests/evaluation/`) passes every runner result through the same checks (W0-07 3.4 steps 4-5)
// and the same deadline as the product.
import { Value } from 'typebox/value';
import { LANE_MAPPINGS_BY_VERSION } from '@rai/shared/constants';
import type { QcRunRequest, QcRunResult, QcRunner, QcUnavailableReason } from '@rai/shared/qc/types';
import {
  QcEngineIdentitySchema,
  checkOwningLane,
  duplicateFindingKey,
  validateQcFinding,
} from '@rai/shared/qc/validate';
import { ENGINE_IDENTITY_INVALID } from './engine-identity.js';

export function unavailableResult(
  reason: QcUnavailableReason,
  detail: string | null,
  stamp: Date,
): QcRunResult {
  const at = stamp.toISOString();
  return { status: 'unavailable', reason, detail, startedAt: at, finishedAt: at };
}

/**
 * W0-07 3.4 steps 4-5: the first finding that fails validation or the owning-lane check fails the whole run. W4-11b:
 * an `engine` identity that is not identifiers and bounded numbers fails it too (`engine_identity_invalid`) and is
 * not recorded; a valid one is kept on a run a finding refused, since that runner did use it. W4-06a: the request is
 * the validation context, so its artifacts bound every citation (`evidence_outside_request`), and two findings of the
 * run with one `findingKey` fail it (`duplicate_finding_key`, decision 30).
 */
export function checkedResult(result: QcRunResult, request: QcRunRequest, stamp: Date): QcRunResult {
  if (result.engine !== undefined && !Value.Check(QcEngineIdentitySchema, result.engine))
    return unavailableResult('runner_error', ENGINE_IDENTITY_INVALID, stamp);
  if (result.status === 'unavailable') return result;
  const mapping = LANE_MAPPINGS_BY_VERSION[request.laneMappingVersion];
  for (const finding of result.findings) {
    // An unknown mapping can vouch for no lane.
    const violation =
      validateQcFinding(finding, request) ??
      (mapping === undefined ? 'owning_lane_mismatch' : checkOwningLane(finding, mapping, request.lane));
    if (violation !== null)
      return {
        ...unavailableResult('runner_error', violation, stamp),
        ...(result.engine === undefined ? {} : { engine: result.engine }),
      };
  }
  const duplicate = duplicateFindingKey(result.findings);
  if (duplicate !== null)
    return {
      ...unavailableResult('runner_error', duplicate, stamp),
      ...(result.engine === undefined ? {} : { engine: result.engine }),
    };
  return result;
}

/**
 * Calls the runner under the deadline and checks its result; a throw is `runner_error`, the deadline `timeout`.
 * W4-05a: `revoke` (the request's artifact-handle revocation) runs when the deadline aborts the signal, even if the
 * runner ignores it and has not settled, and again once the runner settles; it must be idempotent.
 */
export async function callRunner(
  runner: QcRunner,
  request: QcRunRequest,
  stamp: Date,
  timeoutMs: number,
  revoke?: () => void,
): Promise<QcRunResult> {
  const controller = new AbortController();
  if (revoke !== undefined) controller.signal.addEventListener('abort', revoke, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return checkedResult(await runner.run(request, controller.signal), request, stamp);
  } catch {
    return unavailableResult(controller.signal.aborted ? 'timeout' : 'runner_error', null, stamp);
  } finally {
    clearTimeout(timer);
    if (revoke !== undefined) {
      controller.signal.removeEventListener('abort', revoke);
      revoke();
    }
  }
}
