// W4-08a (W4b plan section 11.2 "Runs in-process, no database"): runs both QC run parts of every labelled trigger of
// an evaluation split, the way the product runs them.
//
//   - Each `QcRunRequest` is built by the orchestrator's own `requestOf` (server/src/qc/request.ts) from synthetic case,
//     version and slot rows, with the rules `requestRules` selects from the catalogue (the seeded `qc_rules` body by
//     default); only the artifacts' read handles are bound here, to the rendered bytes (W4-05a binds the blob store).
//   - Both parts run on that request (decision 27): the W4a deterministic runner and the content runner over the
//     extractor passed in. Each result goes through the orchestrator's `callRunner` (the 10 000 ms deadline and
//     `checkedResult`, W0-07 3.4 steps 4-5). An unknown template records both parts `runner_error` without a call.
//   - Every citation is checked by re-extraction (`checkCitations`): the artifact must be one of the request's, with
//     the same slot and content hash, and the excerpt hash must be the hash of the text the extractor yields at the
//     cited locator (the segment there, or the claim the rule's grammar reads there).
//
// Document text stays in this process's memory; a part record carries findings, identities and numbers only.
import { createHash } from 'node:crypto';
import { CURRENT_LANE_MAPPING, type Lane } from '@rai/shared/constants';
import type {
  AuthorizedArtifactRef,
  QcEngineIdentity,
  QcFinding,
  QcRunResult,
  QcRunner,
  QcTrigger,
  QcUnavailableReason,
  SelectedRule,
  SlotNumber,
} from '@rai/shared/qc/types';
import type { AllowedMediaType } from '@rai/shared/schemas/artifacts';
import type { ClaimLabels, ConfigurationBodies } from '@rai/shared/schemas/cases';
import { CONFIGURATION_SEED } from '@rai/server/configuration/seed';
import { callRunner, unavailableResult } from '@rai/server/qc/check-result';
import { parseClaims } from '@rai/server/qc/content/claims';
import { excerptHashOf } from '@rai/server/qc/content/excerpt';
import { createContentQcRunner } from '@rai/server/qc/content/runner';
import { createDeterministicQcRunner } from '@rai/server/qc/deterministic/runner';
import type { ExtractResult, Extractor } from '@rai/server/qc/extraction/port';
import { QC_TIMEOUT_MS } from '@rai/server/qc/orchestrator';
import { requestOf, type RequestArtifactRow, type RequestSlotRead } from '@rai/server/qc/request';
import { requestRules } from '@rai/server/qc/rules-revision';
import { RuleSelectionError } from '@rai/server/qc/select';
import type { LabelPartOutcome, RunPart } from '@rai/fixtures/evaluation/types';
import { canonicalJson, rulesIdentity, type RunnerIdentity } from './identity.js';
import type { LoadedCase, LoadedSet } from './load-set.js';

export type QcRulesBody = ConfigurationBodies['qc_rules'];

export type CitationProblem =
  | 'artifact_not_in_request'
  | 'content_hash_mismatch'
  | 'excerpt_hash_missing'
  | 'reextract_failed'
  | 'locator_not_found'
  | 'excerpt_hash_mismatch';

/** One evidence entry that cites an artifact, and whether it is grounded. Identities only. */
export interface CitationCheck {
  ruleId: string;
  slot: SlotNumber | null;
  locatorKind: string;
  grounded: boolean;
  problem: CitationProblem | null;
}

/** One run part of one labelled trigger: what the label expects and what the runner recorded. */
export interface PartRecord {
  caseId: string;
  trigger: QcTrigger;
  lane: Lane | null;
  slot: SlotNumber | null; // the uploaded slot; null for submit and approve attempts
  part: RunPart;
  expected: LabelPartOutcome;
  runner: string;
  runnerVersion: string;
  status: 'completed' | 'unavailable';
  reason: QcUnavailableReason | null;
  detail: string | null;
  findings: QcFinding[];
  latencyMs: number;
  engine: QcEngineIdentity | null;
  citations: CitationCheck[];
}

export interface HarnessOutput {
  parts: PartRecord[];
  runners: Record<RunPart, RunnerIdentity>;
  extractorVersion: string;
  rulesRevision: string;
}

export interface HarnessOptions {
  extractor: Extractor;
  /** The `qc_rules` body whose rules the requests carry; defaults to the seeded catalogue. */
  catalogue?: QcRulesBody;
  now?: () => Date;
  timeoutMs?: number;
  /** Test seam: a runner in place of a product one (the orchestrator's checks and deadline still apply). */
  runners?: Partial<Record<RunPart, QcRunner>>;
}

/** A citable artifact of one request: its slot, content hash and bytes. */
export interface CitableArtifact {
  slot: SlotNumber;
  contentHash: string;
  mediaType: AllowedMediaType;
  bytes: Uint8Array;
}

type RuleWithParams = Pick<SelectedRule, 'ruleId'> & { params?: unknown };

/** Every rule of the catalogue once, in catalogue order, with its engine. */
export function catalogueRulesOf(
  catalogue: QcRulesBody,
): Array<{ ruleId: string; engine: 'metadata' | 'content' }> {
  const out = new Map<string, 'metadata' | 'content'>();
  for (const template of Object.values(catalogue.templates))
    for (const rule of template.rules) if (!out.has(rule.ruleId)) out.set(rule.ruleId, rule.engine);
  return [...out].map(([ruleId, engine]) => ({ ruleId, engine }));
}

/** A stable synthetic UUID (version 7 shape) for an evaluation identifier. */
function uuidOf(name: string): string {
  const h = createHash('sha256').update(`qc-eval:${name}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-7${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

function labelsOf(params: unknown): ClaimLabels | undefined {
  if (typeof params !== 'object' || params === null || !('labels' in params)) return undefined;
  const { labels } = params;
  return typeof labels === 'object' && labels !== null ? (labels as ClaimLabels) : undefined;
}

/**
 * Checks every evidence entry of the findings that names an artifact (W4b plan 11.2 "grounded-citation rate"). An
 * `absent` locator is grounded on the artifact alone; an entry with no artifact is not a citation. Re-extractions
 * are cached by content hash in `cache`.
 */
export async function checkCitations(
  findings: readonly QcFinding[],
  artifacts: ReadonlyMap<string, CitableArtifact>,
  extractor: Extractor,
  rules: readonly RuleWithParams[],
  cache: Map<string, Promise<ExtractResult>> = new Map(),
): Promise<CitationCheck[]> {
  const out: CitationCheck[] = [];
  for (const finding of findings)
    for (const e of finding.evidence) {
      if (e.artifactId === null) continue;
      const check = (problem: CitationProblem | null): CitationCheck => ({
        ruleId: finding.ruleId,
        slot: e.slot,
        locatorKind: e.locator.kind,
        grounded: problem === null,
        problem,
      });
      const artifact = artifacts.get(e.artifactId);
      if (artifact === undefined || artifact.slot !== e.slot) {
        out.push(check('artifact_not_in_request'));
        continue;
      }
      if (e.contentHash !== artifact.contentHash) {
        out.push(check('content_hash_mismatch'));
        continue;
      }
      if (e.locator.kind === 'absent') {
        out.push(check(null));
        continue;
      }
      if (e.excerptHash === undefined) {
        out.push(check('excerpt_hash_missing'));
        continue;
      }
      let extracted = cache.get(artifact.contentHash);
      if (extracted === undefined) {
        extracted = extractor.extract(
          { mediaType: artifact.mediaType, bytes: artifact.bytes },
          new AbortController().signal,
        );
        cache.set(artifact.contentHash, extracted);
      }
      const result = await extracted;
      if (!result.ok) {
        out.push(check('reextract_failed'));
        continue;
      }
      const where = canonicalJson(e.locator);
      const texts = result.segments.filter((s) => canonicalJson(s.locator) === where).map((s) => s.text);
      const labels = labelsOf(rules.find((r) => r.ruleId === finding.ruleId)?.params);
      if (labels !== undefined)
        for (const claim of parseClaims(result.segments, labels))
          if (canonicalJson(claim.locator) === where) texts.push(claim.excerpt);
      if (texts.length === 0) out.push(check('locator_not_found'));
      else
        out.push(
          check(texts.some((t) => excerptHashOf(t) === e.excerptHash) ? null : 'excerpt_hash_mismatch'),
        );
    }
  return out;
}

interface CaseRows {
  read: RequestSlotRead;
  caseRow: { modelType: string; vendorInvolved: boolean };
  submitted: Parameters<typeof requestOf>[2];
  draft: Parameters<typeof requestOf>[2];
  citable: Map<string, CitableArtifact>;
}

/** The rows the orchestrator would read for this case: nine slot rows, their artifact rows, the case and version. */
function rowsOf(loaded: LoadedCase): CaseRows {
  const { evalCase } = loaded;
  const citable = new Map<string, CitableArtifact>();
  const artifacts = new Map<string, RequestArtifactRow>();
  const rows = evalCase.slots.map((s) => {
    const doc = loaded.documents.get(s.slot);
    let artifactId: string | null = null;
    if (s.disposition === 'attached' && doc !== undefined) {
      artifactId = uuidOf(`artifact:${doc.documentId}`);
      artifacts.set(artifactId, {
        artifactId,
        sha256: doc.sha256,
        mediaType: doc.mediaType,
        filename: doc.filename, // stays in the request, as in the product; no record carries it
        sizeBytes: doc.bytes.byteLength,
      });
      citable.set(artifactId, {
        slot: s.slot,
        contentHash: doc.sha256,
        mediaType: doc.mediaType,
        bytes: doc.bytes,
      });
    }
    return {
      slot: s.slot,
      state: s.disposition,
      reason: s.disposition === 'not_applicable' ? s.reason : null,
      artifactId,
    };
  });
  const submitted = {
    id: uuidOf(`version:${evalCase.caseId}`),
    caseId: uuidOf(`case:${evalCase.caseId}`),
    versionNumber: 1,
    submittedAt: new Date('2026-09-27T00:00:00Z'),
    laneMappingVersion: CURRENT_LANE_MAPPING.version,
    checklistTemplateVersion: evalCase.checklistTemplateVersion,
    stageContext: evalCase.stageContext,
  };
  return {
    read: { rows, artifacts },
    caseRow: { modelType: evalCase.modelType, vendorInvolved: evalCase.vendorInvolved },
    submitted,
    // The upload run's row is the open draft that becomes the version at submit (W4-04).
    draft: { ...submitted, submittedAt: null, laneMappingVersion: null },
    citable,
  };
}

export async function runEvalSet(set: LoadedSet, options: HarnessOptions): Promise<HarnessOutput> {
  const catalogue = options.catalogue ?? CONFIGURATION_SEED.qc_rules;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? QC_TIMEOUT_MS;
  const rulesRevision = rulesIdentity(catalogue).revision;
  const runners: Record<RunPart, QcRunner> = {
    deterministic: options.runners?.deterministic ?? createDeterministicQcRunner({ now }),
    content: options.runners?.content ?? createContentQcRunner({ extractor: options.extractor, now }),
  };
  const cache = new Map<string, Promise<ExtractResult>>();
  const parts: PartRecord[] = [];
  let sequence = 0;
  for (const loaded of set.cases) {
    const rows = rowsOf(loaded);
    const { evalCase } = loaded;
    for (const run of loaded.labels.runs) {
      const uploadSlot = run.trigger === 'upload' ? run.slot : null;
      const stamp = now();
      let rules: SelectedRule[] | null = null;
      let selectionError: RuleSelectionError | undefined;
      try {
        rules = requestRules(
          { ruleRevision: rulesRevision, catalogue },
          evalCase.checklistTemplateVersion,
          run.trigger,
          evalCase.modelType,
        );
      } catch (error) {
        if (!(error instanceof RuleSelectionError)) throw error;
        selectionError = error;
      }
      sequence += 1;
      const built = requestOf(
        rows.read,
        rows.caseRow,
        run.trigger === 'upload' ? rows.draft : rows.submitted,
        run.trigger,
        run.lane,
        uuidOf(`correlation:${sequence}`),
        stamp.getTime() + timeoutMs,
        rulesRevision,
        rules,
        null, // W5-10: the evaluation cases carry no risk proposal, so RISK-TIER-UNKNOWN raises nothing
        uploadSlot,
      );
      const artifacts: AuthorizedArtifactRef[] = built.artifacts.map((a) => {
        const bytes = rows.citable.get(a.artifactId)!.bytes;
        return { ...a, read: () => Promise.resolve(streamOf(bytes)) };
      });
      const request = { ...built, artifacts };
      const citable = new Map([...rows.citable].filter(([id]) => artifacts.some((a) => a.artifactId === id)));
      for (const part of ['deterministic', 'content'] as const) {
        const runner = runners[part];
        const started = performance.now();
        const result: QcRunResult =
          selectionError === undefined
            ? await callRunner(runner, request, stamp, timeoutMs)
            : unavailableResult('runner_error', selectionError.detail, stamp);
        const latencyMs = Math.round((performance.now() - started) * 10) / 10;
        const findings = result.status === 'completed' ? result.findings : [];
        parts.push({
          caseId: evalCase.caseId,
          trigger: run.trigger,
          lane: run.lane,
          slot: uploadSlot,
          part,
          expected: run.parts[part],
          runner: runner.identity.runner,
          runnerVersion: runner.identity.runnerVersion,
          status: result.status,
          reason: result.status === 'unavailable' ? result.reason : null,
          detail: result.status === 'unavailable' ? result.detail : null,
          findings,
          latencyMs,
          engine: result.engine ?? null,
          citations: await checkCitations(findings, citable, options.extractor, rules ?? [], cache),
        });
      }
    }
  }
  return {
    parts,
    runners: {
      deterministic: { ...runners.deterministic.identity },
      content: { ...runners.content.identity },
    },
    extractorVersion: options.extractor.version,
    rulesRevision,
  };
}
