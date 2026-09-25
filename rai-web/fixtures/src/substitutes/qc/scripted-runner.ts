// W0-07 section 3.9: `ScriptedQcRunner`, the slice-1 QC substitute behind the shared `QcRunner` port. It returns
// scripted synthetic findings for a fixture case, an explicit `unavailable` result on demand, and a simulated
// timeout. It is a substitute: QC is not implemented here (W4, ADR-0006 under D08/D09) and nothing in this module
// labels it as such. Authority limits (W0-07 3.1): the runner receives a request and an AbortSignal and returns
// data; it holds no store, no session, no HTTP client, no filesystem handle and never reads the environment. The
// colocated tests prove the module graph reaches only `@rai/shared` and that a run leaves the request untouched.

import type { Lane } from '@rai/shared/constants';
import { LANE_MAPPINGS_BY_VERSION } from '@rai/shared/constants';
import type {
  AuthorizedArtifactRef,
  EvidenceLocation,
  FindingScope,
  QcFinding,
  QcRunRequest,
  QcRunResult,
  QcRunner,
  QcUnavailableReason,
  SlotNumber,
  VersionRef,
} from '@rai/shared/qc/types';
import { checkOwningLane, findingKeyOf, validateQcFinding } from '@rai/shared/qc/validate';
import { SUBSTITUTE_MARKER } from '../../substitute-marker.js';
import {
  BUNDLED_QC_SCRIPTS,
  QcScriptError,
  selectorKey,
  validateScript,
  type QcScript,
  type ScriptEntry,
  type ScriptSelector,
  type ScriptedFinding,
} from './scripts.js';
import { QC_SUBSTITUTE_RUNNER, QC_SUBSTITUTE_RUNNER_VERSION } from './version.js';

/** W0-10 section 5.5 `HealthProbes['qc']` answer; the W0-10 8.1 substitute hook. */
export type QcHealthAnswer = 'ok' | 'unavailable' | 'disabled';

export type TimeoutMode = 'hang' | 'immediate';
export type TimeoutSelector = { versionId?: string } | 'next';

/** W0-07 3.9 test control API. Only on the instance; never reachable over HTTP. */
export interface ScriptedQcRunnerControl {
  script(selector: ScriptSelector, findings: ScriptedFinding[]): void;
  simulateTimeout(mode: TimeoutMode, selector?: TimeoutSelector): void;
  simulateError(reason: 'runner_error' | 'artifact_unreadable', selector?: 'next'): void;
  health(answer: QcHealthAnswer): void;
  readonly calls: ReadonlyArray<{ request: QcRunRequest; at: string }>;
  reset(): void;
}

export interface ScriptedQcRunnerOptions {
  /** Validated scripts; default: the bundled W0-08 fixture-case scripts. */
  scripts?: readonly QcScript[];
  /** Maps a request's version to its fixture case id; default: `version.caseId` when it is an `fx-case-*` id. */
  fixtureCaseIdOf?: (version: VersionRef) => string | undefined;
  /** A script that names a slot/artifact the request lacks: throw (tests, default) or answer `unavailable:runner_error`. */
  onScriptMismatch?: 'throw' | 'unavailable';
  /** Timestamp source; default `Date`. Injected only so tests can pin `startedAt`/`finishedAt`. */
  now?: () => Date;
}

type Simulation =
  | { kind: 'timeout'; mode: TimeoutMode; versionId: string | null }
  | { kind: 'error'; reason: 'runner_error' | 'artifact_unreadable' };

function abortError(): Error {
  return new DOMException('The QC run was aborted by its signal', 'AbortError');
}

function defaultFixtureCaseIdOf(version: VersionRef): string | undefined {
  return version.caseId.startsWith('fx-case-') ? version.caseId : undefined;
}

export class ScriptedQcRunner implements QcRunner, ScriptedQcRunnerControl {
  static readonly marker = SUBSTITUTE_MARKER; // W0-02 section 1.1: `check:substitute-absent` greps for it

  readonly identity = Object.freeze({
    runner: QC_SUBSTITUTE_RUNNER,
    runnerVersion: QC_SUBSTITUTE_RUNNER_VERSION,
  });

  readonly #bundled: ReadonlyMap<string, { script: QcScript; entry: ScriptEntry }>;
  readonly #fixtureCaseIdOf: (version: VersionRef) => string | undefined;
  readonly #onScriptMismatch: 'throw' | 'unavailable';
  readonly #now: () => Date;

  #overrides = new Map<string, { script: QcScript; entry: ScriptEntry }>();
  #simulations: Simulation[] = [];
  #health: QcHealthAnswer = 'ok';
  #calls: { request: QcRunRequest; at: string }[] = [];

  constructor(options: ScriptedQcRunnerOptions = {}) {
    const table = new Map<string, { script: QcScript; entry: ScriptEntry }>();
    for (const script of options.scripts ?? BUNDLED_QC_SCRIPTS) {
      for (const entry of script.entries) {
        const key = selectorKey({
          fixtureCaseId: script.fixtureCaseId,
          trigger: entry.trigger,
          ...(entry.lane === undefined ? {} : { lane: entry.lane }),
        });
        if (table.has(key)) throw new QcScriptError('duplicate_entry', key);
        table.set(key, { script, entry });
      }
    }
    this.#bundled = table;
    this.#fixtureCaseIdOf = options.fixtureCaseIdOf ?? defaultFixtureCaseIdOf;
    this.#onScriptMismatch = options.onScriptMismatch ?? 'throw';
    this.#now = options.now ?? (() => new Date());
  }

  get calls(): ReadonlyArray<{ request: QcRunRequest; at: string }> {
    return this.#calls;
  }

  // ---- control API -------------------------------------------------------------------------------------------

  script(selector: ScriptSelector, findings: ScriptedFinding[]): void {
    // A test-authored entry is validated like a bundled one. Its lane mapping and checklist template come from the
    // case's bundled script when one exists; otherwise from the first measure (every measure must agree, L12).
    const bundled = [...this.#bundled.values()].find(
      (b) => b.script.fixtureCaseId === selector.fixtureCaseId,
    );
    const templateOfMeasures = findings.find((f) => f.measure !== null)?.measure?.thresholdSource;
    const script = validateScript({
      fixtureCaseId: selector.fixtureCaseId,
      laneMappingVersion: bundled?.script.laneMappingVersion ?? 'lane-mapping/v1',
      checklistTemplateVersion:
        bundled?.script.checklistTemplateVersion ?? templateOfMeasures ?? 'unscripted',
      entries: [
        {
          trigger: selector.trigger,
          ...(selector.lane === undefined ? {} : { lane: selector.lane }),
          findings,
        },
      ],
    });
    this.#overrides.set(selectorKey(selector), { script, entry: script.entries[0]! });
  }

  simulateTimeout(mode: TimeoutMode, selector: TimeoutSelector = 'next'): void {
    const versionId = selector === 'next' ? null : (selector.versionId ?? null);
    this.#simulations.push({ kind: 'timeout', mode, versionId });
  }

  simulateError(reason: 'runner_error' | 'artifact_unreadable', _selector: 'next' = 'next'): void {
    this.#simulations.push({ kind: 'error', reason });
  }

  health(answer: QcHealthAnswer): void {
    this.#health = answer;
  }

  /** The W0-10 5.5 `HealthProbes.qc` function: readiness reports this answer; QC never gates readiness. */
  probe(): Promise<QcHealthAnswer> {
    return Promise.resolve(this.#health);
  }

  reset(): void {
    this.#overrides = new Map();
    this.#simulations = [];
    this.#health = 'ok';
    this.#calls = [];
  }

  // ---- the port ----------------------------------------------------------------------------------------------

  async run(request: QcRunRequest, signal: AbortSignal): Promise<QcRunResult> {
    const startedAt = this.#now().toISOString();
    this.#calls.push({ request, at: startedAt });
    if (signal.aborted) throw abortError();

    const simulation = this.#takeSimulation(request);
    if (simulation !== undefined) {
      if (simulation.kind === 'error')
        return this.#unavailable(simulation.reason, `simulated:${simulation.reason}`, startedAt);
      if (simulation.mode === 'immediate')
        return this.#unavailable('timeout', 'simulated:timeout', startedAt);
      await hangUntilAborted(signal); // 'hang': resolves only when the orchestrator's timer aborts, then rejects
      throw abortError();
    }

    const selected = this.#select(request);
    if (selected === undefined) {
      return {
        status: 'completed',
        findings: [],
        rulesEvaluated: [],
        startedAt,
        finishedAt: this.#now().toISOString(),
      };
    }
    let findings: QcFinding[];
    try {
      findings = materializeFindings(selected.entry, request, this.identity);
    } catch (error) {
      if (this.#onScriptMismatch === 'unavailable' && error instanceof QcScriptError) {
        return this.#unavailable('runner_error', error.code, startedAt);
      }
      throw error;
    }
    const rulesEvaluated = selected.entry.rulesEvaluated ?? [...new Set(findings.map((f) => f.ruleId))];
    return {
      status: 'completed',
      findings,
      rulesEvaluated,
      startedAt,
      finishedAt: this.#now().toISOString(),
    };
  }

  // ---- internals ---------------------------------------------------------------------------------------------

  #lookup(selector: ScriptSelector): { script: QcScript; entry: ScriptEntry } | undefined {
    const key = selectorKey(selector);
    return this.#overrides.get(key) ?? this.#bundled.get(key);
  }

  #select(request: QcRunRequest): { script: QcScript; entry: ScriptEntry } | undefined {
    const fixtureCaseId = this.#fixtureCaseIdOf(request.version);
    if (fixtureCaseId === undefined) return undefined;
    const lane: Lane | undefined =
      request.trigger === 'approve_attempt' && request.lane !== null ? request.lane : undefined;
    return this.#lookup({ fixtureCaseId, trigger: request.trigger, ...(lane === undefined ? {} : { lane }) });
  }

  #takeSimulation(request: QcRunRequest): Simulation | undefined {
    const index = this.#simulations.findIndex(
      (s) => s.kind === 'error' || s.versionId === null || s.versionId === request.version.versionId,
    );
    if (index === -1) return undefined;
    return this.#simulations.splice(index, 1)[0];
  }

  #unavailable(reason: QcUnavailableReason, detail: string, startedAt: string): QcRunResult {
    // No lane on the result (W0-06 7.4); `detail` is a fixed token, never a filename, document text or an address.
    return { status: 'unavailable', reason, detail, startedAt, finishedAt: this.#now().toISOString() };
  }
}

function hangUntilAborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

/**
 * Turns the script's findings into `QcFinding` values for this request (W0-07 3.9 "rewrites `ruleRevision` to
 * `request.qcRulesRevision` and validates each finding's `scope` against the request's slots and artifacts").
 * For the `upload` trigger only the findings on the uploaded slot apply (the run evaluates that artifact's own
 * rules); for `submit` and `approve_attempt` every scripted finding must resolve, or the script is wrong.
 */
export function materializeFindings(
  entry: ScriptEntry,
  request: QcRunRequest,
  provenance: { runner: string; runnerVersion: string },
): QcFinding[] {
  const requestSlots = new Set(request.slots.map((s) => s.slot));
  const applicable =
    request.trigger === 'upload'
      ? entry.findings.filter((f) => f.scope.kind !== 'pack' && requestSlots.has(f.scope.slot))
      : entry.findings;
  const mapping = LANE_MAPPINGS_BY_VERSION[request.laneMappingVersion];
  if (mapping === undefined)
    throw new QcScriptError('lane_mapping_version_unknown', request.laneMappingVersion);
  return applicable.map((scripted) => {
    const where = `${request.trigger}:${scripted.ruleId}`;
    const scope = resolveScope(scripted, request, where);
    const evidence: EvidenceLocation[] = scripted.evidence.map((e) => {
      const ref =
        e.fixtureArtifactId === undefined || e.slot === null
          ? undefined
          : attachedArtifact(request, e.slot, where);
      const location: EvidenceLocation = {
        artifactId: ref?.artifactId ?? null,
        contentHash: ref?.contentHash ?? null,
        slot: e.slot,
        locator: e.locator,
      };
      if (e.excerptHash !== undefined) location.excerptHash = e.excerptHash;
      return location;
    });
    const finding: QcFinding = {
      findingKey: findingKeyOf(scripted.ruleId, scope),
      ruleId: scripted.ruleId,
      ruleRevision: request.qcRulesRevision,
      trigger: request.trigger,
      scope,
      severity: scripted.severity,
      owningLane: scripted.owningLane,
      evidence,
      measure: scripted.measure === null ? null : { ...scripted.measure },
      message: { key: scripted.message.key, params: { ...scripted.message.params } },
      provenance: { runner: provenance.runner, runnerVersion: provenance.runnerVersion },
    };
    const violation = validateQcFinding(finding, request) ?? checkOwningLane(finding, mapping, request.lane);
    if (violation !== null) throw new QcScriptError(violation, where);
    return finding;
  });
}

function resolveScope(scripted: ScriptedFinding, request: QcRunRequest, where: string): FindingScope {
  const { scope } = scripted;
  if (scope.kind === 'pack') return { kind: 'pack' };
  if (scope.kind === 'slot') {
    if (!request.slots.some((s) => s.slot === scope.slot))
      throw new QcScriptError('slot_not_in_request', where);
    return { kind: 'slot', slot: scope.slot };
  }
  const ref = attachedArtifact(request, scope.slot, where);
  return {
    kind: 'artifact',
    slot: scope.slot,
    artifactId: ref.artifactId,
    contentHash: ref.contentHash,
  };
}

function attachedArtifact(request: QcRunRequest, slot: SlotNumber, where: string): AuthorizedArtifactRef {
  const slotState = request.slots.find((s) => s.slot === slot);
  if (slotState === undefined) throw new QcScriptError('slot_not_in_request', where);
  if (slotState.disposition !== 'attached' || slotState.artifactId === null)
    throw new QcScriptError('artifact_not_attached', where);
  const ref = request.artifacts.find((a) => a.slot === slot && a.artifactId === slotState.artifactId);
  if (ref === undefined) throw new QcScriptError('artifact_not_in_request', where);
  return ref;
}
