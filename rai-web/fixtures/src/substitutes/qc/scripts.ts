// W0-07 section 3.9 "Script selection": a script is a JSON file of findings keyed by (fixtureCaseId, trigger, lane?).
// Scripts ship inside this directory and are bundled as static JSON imports (no node:fs, no configuration key
// names them). Each script finding is a `QcFinding` minus the fields the run supplies: `findingKey` (derived),
// `ruleRevision` (the request's), `trigger` (the entry's), `provenance` (the runner's), and the artifact row
// identity. Artifact row ids are UUIDs minted by the W1-09 loader, so a script names the W0-08 fixture document
// id (`fx-doc-<case>-<slot>`) plus its slot and the runner resolves `artifactId`/`contentHash` from the request's
// authorized artifact in that slot (W0-08 section 8.4: defects are "scripted against the fixture artifact ID").
//
// W0-06 section 7 as recorded on 2026-09-25 (#35), enforced by `validateScript` at construction: every finding
// carries the lane `owningLaneRule` gives its scope (single-lane slot: that lane; slot 5: a reviewing lane, and on
// an approve attempt the run's lane; pack: AI/COE); slot 9 carries no defects; no run-scoped finding and never
// `QC-UNAVAILABLE`, which only the orchestrator builds (W0-07 3.6).

import { LANES, LANE_MAPPINGS_BY_VERSION, SLOTS, type Lane, owningLaneRule } from '@rai/shared/constants';
import { QC_RULE_ID_PATTERN } from '@rai/shared/qc/types';
import type { EvidenceLocator, Measure, QcTrigger, Severity, SlotNumber } from '@rai/shared/qc/types';
import { isLocaleKey } from '@rai/shared/locales/keys';
import { isEvidenceLocator, isMeasure } from '@rai/shared/qc/validate';
import fxCaseNonvendor from './scripts/fx-case-nonvendor.json' with { type: 'json' };
import fxCaseVendor from './scripts/fx-case-vendor.json' with { type: 'json' };
import fxCaseMissingSlot from './scripts/fx-case-missing-slot.json' with { type: 'json' };
import fxCaseNaReasons from './scripts/fx-case-na-reasons.json' with { type: 'json' };

export type ScriptedScope =
  | { kind: 'artifact'; slot: SlotNumber; fixtureArtifactId: string }
  | { kind: 'slot'; slot: SlotNumber }
  | { kind: 'pack' };

export interface ScriptedEvidence {
  fixtureArtifactId?: string; // resolved to the request artifact in `slot`; absent for an omission
  slot: SlotNumber | null;
  locator: EvidenceLocator;
  excerptHash?: string; // sha256 hex of a synthetic excerpt; never the excerpt (W0-07 3.1)
}

export interface ScriptedFinding {
  ruleId: string;
  scope: ScriptedScope;
  severity: Severity;
  owningLane: Lane;
  evidence: ScriptedEvidence[];
  measure: Measure | null;
  message: { key: string; params: Record<string, string | number> };
}

export interface ScriptSelector {
  fixtureCaseId: string;
  trigger: QcTrigger;
  lane?: Lane; // set only for approve_attempt
}

export interface ScriptEntry {
  trigger: QcTrigger;
  lane?: Lane;
  findings: ScriptedFinding[];
  rulesEvaluated?: string[]; // defaults to the distinct ruleIds of `findings`
}

export interface QcScript {
  fixtureCaseId: string;
  laneMappingVersion: string; // the W0-06 constant the script's owning lanes were checked against
  checklistTemplateVersion: string; // every `measure.thresholdSource` in the script equals this (L12)
  entries: ScriptEntry[];
}

/** A script bug: thrown at construction or, for request-dependent checks, at run (W0-07 3.9 "the substitute throws"). */
export class QcScriptError extends Error {
  constructor(
    readonly code: string,
    readonly where: string,
  ) {
    super(`${code} at ${where}`); // ids and rule names only; never document text or a filename
    this.name = 'QcScriptError';
  }
}

const FIXTURE_DOC_ID = /^fx-doc-(\d{4})-(\d{2})$/;
const TRIGGERS: readonly QcTrigger[] = ['upload', 'submit', 'approve_attempt'];
const SEVERITIES: readonly Severity[] = ['high', 'medium', 'low'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(code: string, where: string): never {
  throw new QcScriptError(code, where);
}

function validateEvidence(raw: unknown, where: string): ScriptedEvidence {
  if (!isRecord(raw)) fail('evidence_not_object', where);
  for (const key of Object.keys(raw)) {
    if (!['fixtureArtifactId', 'slot', 'locator', 'excerptHash'].includes(key))
      fail('document_text_field', where);
  }
  const slot = raw['slot'];
  if (slot !== null && !(SLOTS as readonly unknown[]).includes(slot)) fail('evidence_slot_invalid', where);
  if (!isEvidenceLocator(raw['locator'])) fail('evidence_locator_invalid', where);
  const evidence: ScriptedEvidence = {
    slot: slot as SlotNumber | null,
    locator: raw['locator'],
  };
  if (raw['fixtureArtifactId'] !== undefined) {
    if (typeof raw['fixtureArtifactId'] !== 'string' || !FIXTURE_DOC_ID.test(raw['fixtureArtifactId']))
      fail('fixture_artifact_id_invalid', where);
    if (slot === null || Number(raw['fixtureArtifactId'].slice(-2)) !== slot)
      fail('fixture_artifact_slot_mismatch', where);
    evidence.fixtureArtifactId = raw['fixtureArtifactId'];
  }
  if (raw['excerptHash'] !== undefined) {
    if (typeof raw['excerptHash'] !== 'string' || !/^[0-9a-f]{64}$/.test(raw['excerptHash']))
      fail('excerpt_hash_invalid', where);
    evidence.excerptHash = raw['excerptHash'];
  }
  return evidence;
}

function validateFinding(raw: unknown, script: QcScript, entry: ScriptEntry, where: string): ScriptedFinding {
  if (!isRecord(raw)) fail('finding_not_object', where);
  const allowed = ['ruleId', 'scope', 'severity', 'owningLane', 'evidence', 'measure', 'message'];
  for (const key of Object.keys(raw)) if (!allowed.includes(key)) fail(`unknown_field:${key}`, where);
  const ruleId = raw['ruleId'];
  if (typeof ruleId !== 'string' || !QC_RULE_ID_PATTERN.test(ruleId)) fail('rule_id_invalid', where);
  if (ruleId === 'QC-UNAVAILABLE') fail('qc_unavailable_rule_forbidden', where); // orchestrator-built only (3.6)
  const scope = raw['scope'];
  if (!isRecord(scope)) fail('scope_invalid', where);
  if (scope['kind'] === 'run') fail('scope_run_forbidden', where); // orchestrator-built only (3.6)
  if (scope['kind'] !== 'artifact' && scope['kind'] !== 'slot' && scope['kind'] !== 'pack')
    fail('scope_invalid', where);
  let typedScope: ScriptedScope;
  if (scope['kind'] === 'pack') {
    typedScope = { kind: 'pack' };
  } else {
    const slot = scope['slot'];
    if (!(SLOTS as readonly unknown[]).includes(slot)) fail('scope_slot_invalid', where);
    if (scope['kind'] === 'artifact') {
      const fixtureArtifactId = scope['fixtureArtifactId'];
      if (typeof fixtureArtifactId !== 'string' || !FIXTURE_DOC_ID.test(fixtureArtifactId))
        fail('fixture_artifact_id_invalid', where);
      if (Number(fixtureArtifactId.slice(-2)) !== slot) fail('fixture_artifact_slot_mismatch', where);
      typedScope = { kind: 'artifact', slot: slot as SlotNumber, fixtureArtifactId };
    } else {
      typedScope = { kind: 'slot', slot: slot as SlotNumber };
    }
  }
  const severity = raw['severity'];
  if (!(SEVERITIES as readonly unknown[]).includes(severity)) fail('severity_invalid', where);
  const owningLane = raw['owningLane'];
  if (!(LANES as readonly unknown[]).includes(owningLane)) fail('owning_lane_invalid', where);
  const mapping = LANE_MAPPINGS_BY_VERSION[script.laneMappingVersion];
  if (mapping === undefined) fail('lane_mapping_version_unknown', where);
  const rule = owningLaneRule(typedScope, mapping); // W0-06 section 7
  if (rule.kind === 'no_defects')
    fail(`scope_slot_${String(typedScope.kind === 'pack' ? 'pack' : typedScope.slot)}_informational`, where);
  if (rule.kind === 'lane' && rule.lane !== owningLane) fail('owning_lane_mismatch', where);
  if (rule.kind === 'raising_lane' && !rule.lanes.includes(owningLane as Lane))
    fail('owning_lane_mismatch', where);
  if (entry.trigger === 'approve_attempt' && entry.lane !== owningLane) fail('finding_outside_lane', where);
  const rawEvidence = raw['evidence'];
  if (!Array.isArray(rawEvidence) || rawEvidence.length === 0) fail('evidence_missing', where);
  const evidence = rawEvidence.map((e: unknown, i) => validateEvidence(e, `${where}.evidence[${i}]`));
  const measure = raw['measure'];
  if (measure !== null) {
    if (!isMeasure(measure)) fail('measure_invalid', where);
    if (measure.thresholdSource !== script.checklistTemplateVersion) fail('threshold_source_mismatch', where);
  }
  const message = raw['message'];
  if (!isRecord(message) || typeof message['key'] !== 'string' || !isLocaleKey(message['key']))
    fail('message_key_not_locale_key', where); // D12: a key in both catalogues, never text
  if (!isRecord(message['params'])) fail('message_params_invalid', where);
  for (const [k, v] of Object.entries(message['params'])) {
    if (typeof v !== 'string' && typeof v !== 'number') fail(`message_param_invalid:${k}`, where);
  }
  return {
    ruleId,
    scope: typedScope,
    severity: severity as Severity,
    owningLane: owningLane as Lane,
    evidence,
    measure: measure,
    message: { key: message['key'], params: { ...(message['params'] as Record<string, string | number>) } },
  };
}

/** Validates one script (bundled JSON or a test-authored one) and returns a frozen, typed copy. Throws QcScriptError. */
export function validateScript(raw: unknown): QcScript {
  if (!isRecord(raw)) fail('script_not_object', '<script>');
  const fixtureCaseId = raw['fixtureCaseId'];
  if (typeof fixtureCaseId !== 'string' || !/^fx-case-[a-z0-9-]+$/.test(fixtureCaseId))
    fail('fixture_case_id_invalid', '<script>'); // W0-02 section 8.3 convention
  const where = fixtureCaseId;
  if (
    typeof raw['laneMappingVersion'] !== 'string' ||
    LANE_MAPPINGS_BY_VERSION[raw['laneMappingVersion']] === undefined
  )
    fail('lane_mapping_version_unknown', where);
  if (typeof raw['checklistTemplateVersion'] !== 'string' || raw['checklistTemplateVersion'].length === 0)
    fail('checklist_template_version_invalid', where);
  if (!Array.isArray(raw['entries'])) fail('entries_invalid', where);
  const script: QcScript = {
    fixtureCaseId,
    laneMappingVersion: raw['laneMappingVersion'],
    checklistTemplateVersion: raw['checklistTemplateVersion'],
    entries: [],
  };
  const seen = new Set<string>();
  raw['entries'].forEach((rawEntry: unknown, i) => {
    const entryWhere = `${where}.entries[${i}]`;
    if (!isRecord(rawEntry)) fail('entry_not_object', entryWhere);
    const trigger = rawEntry['trigger'];
    if (!(TRIGGERS as readonly unknown[]).includes(trigger)) fail('trigger_invalid', entryWhere);
    const lane = rawEntry['lane'];
    if (trigger === 'approve_attempt') {
      if (!(LANES as readonly unknown[]).includes(lane))
        fail('lane_required_for_approve_attempt', entryWhere);
    } else if (lane !== undefined) {
      fail('lane_only_for_approve_attempt', entryWhere);
    }
    const key = selectorKey({
      fixtureCaseId,
      trigger: trigger as QcTrigger,
      ...(lane === undefined ? {} : { lane: lane as Lane }),
    });
    if (seen.has(key)) fail('duplicate_entry', entryWhere);
    seen.add(key);
    const entry: ScriptEntry = {
      trigger: trigger as QcTrigger,
      ...(lane === undefined ? {} : { lane: lane as Lane }),
      findings: [],
    };
    if (!Array.isArray(rawEntry['findings'])) fail('findings_invalid', entryWhere);
    entry.findings = rawEntry['findings'].map((f: unknown, j) =>
      validateFinding(f, script, entry, `${entryWhere}.findings[${j}]`),
    );
    if (rawEntry['rulesEvaluated'] !== undefined) {
      const rules = rawEntry['rulesEvaluated'];
      if (!Array.isArray(rules) || !rules.every((r) => typeof r === 'string' && QC_RULE_ID_PATTERN.test(r)))
        fail('rules_evaluated_invalid', entryWhere);
      entry.rulesEvaluated = [...(rules as string[])];
    }
    const keys = new Set<string>();
    for (const f of entry.findings) {
      const k = `${f.ruleId}:${f.scope.kind}:${f.scope.kind === 'pack' ? '-' : f.scope.slot}`;
      if (keys.has(k)) fail('duplicate_finding_key', entryWhere);
      keys.add(k);
    }
    script.entries.push(entry);
  });
  return deepFreeze(script);
}

export function selectorKey(selector: ScriptSelector): string {
  return `${selector.fixtureCaseId}|${selector.trigger}|${selector.lane ?? '-'}`;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}

/** The raw bundled scripts, one per W0-08 fixture case that has findings (`fx-case-hr-dualrole` has none). */
export const RAW_BUNDLED_QC_SCRIPTS: readonly unknown[] = Object.freeze([
  fxCaseNonvendor,
  fxCaseVendor,
  fxCaseMissingSlot,
  fxCaseNaReasons,
]);

/** Validated at module load: a malformed bundled script fails every import of the substitute, never a run. */
export const BUNDLED_QC_SCRIPTS: readonly QcScript[] = Object.freeze(
  RAW_BUNDLED_QC_SCRIPTS.map(validateScript),
);
