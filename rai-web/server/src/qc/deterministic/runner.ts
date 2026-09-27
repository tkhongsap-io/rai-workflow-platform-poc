// W4-03 (W4a plan section 4): the deterministic QC runner, the W4a product implementation of the `QcRunner` port
// (W0-07 3.3). It reads only structured pack data (slot states and reasons, stage, model type, vendor flag, the
// catalogue rules the orchestrator selected) and never a document byte: it never calls `artifacts[].read()`, and
// its module graph holds no parser, network or storage module (module-graph.test.ts). No clock but `now`, no store.
//
//   - `request.rules === null` (no `qc_rules` revision applies): `unavailable:not_configured`, never a clean pass.
//   - `engine: 'content'` rules are catalogued for W4b; they are neither executed nor counted in `rulesEvaluated`.
//   - Every `metadata` rule is executed in request order and counted. A metadata rule the runner does not implement,
//     one selected on a trigger it is not defined for, params that fail its schema, an unknown lane mapping or an
//     approve attempt without a lane make the whole run `unavailable:runner_error`: the runner cannot vouch for a
//     shorter result, so it never returns one.
//
// Its output passes W0-07 3.4 steps 4-5 unchanged; the orchestrator validates it like any runner's. start.ts binds it
// for `QC_MODE=deterministic`, valid in every environment since W4-13 (W4a plan section 2).
import { LANE_MAPPINGS_BY_VERSION } from '@rai/shared/constants';
import type {
  QcFinding,
  QcRunRequest,
  QcRunResult,
  QcRunner,
  QcUnavailableReason,
} from '@rai/shared/qc/types';
import { SERVER_PACKAGE_VERSION } from '../../server-version.js';
import { DETERMINISTIC_RUNNER } from '../kind.js';
import { METADATA_RULES } from './rules/index.js';
import { RuleParamsError } from './rules/rule.js';

export interface DeterministicQcRunnerOptions {
  now?: () => Date;
  /** Defaults to the `@rai/server` package version. */
  runnerVersion?: string;
}

/** Why a run is `runner_error`; the value goes to `detail` (no document content, no PII). */
type RunnerErrorDetail =
  | 'unknown_lane_mapping'
  | 'approve_attempt_without_lane'
  | 'unknown_metadata_rule'
  | 'unsupported_rule_trigger'
  | 'invalid_rule_params';

class Unavailable extends Error {
  constructor(
    readonly reason: QcUnavailableReason,
    readonly detail: string,
  ) {
    super(`${reason}: ${detail}`);
  }
}

const runnerError = (detail: RunnerErrorDetail) => new Unavailable('runner_error', detail);

function evaluate(
  request: QcRunRequest,
  identity: QcRunner['identity'],
): { findings: QcFinding[]; rulesEvaluated: string[] } {
  if (request.rules === null) throw new Unavailable('not_configured', 'no_qc_rules_revision');
  const mapping = Object.hasOwn(LANE_MAPPINGS_BY_VERSION, request.laneMappingVersion)
    ? LANE_MAPPINGS_BY_VERSION[request.laneMappingVersion]
    : undefined;
  if (mapping === undefined) throw runnerError('unknown_lane_mapping');
  if (request.trigger === 'approve_attempt' && request.lane === null)
    throw runnerError('approve_attempt_without_lane');

  const findings: QcFinding[] = [];
  const rulesEvaluated: string[] = [];
  for (const rule of request.rules) {
    if (rule.engine !== 'metadata') continue; // content rules run in W4b
    const impl = Object.hasOwn(METADATA_RULES, rule.ruleId) ? METADATA_RULES[rule.ruleId] : undefined;
    if (impl === undefined) throw runnerError('unknown_metadata_rule');
    if (!impl.triggers.includes(request.trigger)) throw runnerError('unsupported_rule_trigger');
    try {
      findings.push(...impl.evaluate({ request, rule, mapping, provenance: identity }));
    } catch (error) {
      if (error instanceof RuleParamsError) throw runnerError('invalid_rule_params');
      throw error;
    }
    rulesEvaluated.push(rule.ruleId);
  }
  return { findings, rulesEvaluated };
}

export function createDeterministicQcRunner(options: DeterministicQcRunnerOptions = {}): QcRunner {
  const now = options.now ?? (() => new Date());
  const identity = Object.freeze({
    runner: DETERMINISTIC_RUNNER,
    runnerVersion: options.runnerVersion ?? SERVER_PACKAGE_VERSION,
  });
  return {
    identity,
    run(request: QcRunRequest): Promise<QcRunResult> {
      const startedAt = now().toISOString();
      try {
        const { findings, rulesEvaluated } = evaluate(request, identity);
        return Promise.resolve({
          status: 'completed',
          findings,
          rulesEvaluated,
          startedAt,
          finishedAt: startedAt,
        });
      } catch (error) {
        if (!(error instanceof Unavailable))
          return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        return Promise.resolve({
          status: 'unavailable',
          reason: error.reason,
          detail: error.detail,
          startedAt,
          finishedAt: startedAt,
        });
      }
    },
  };
}
