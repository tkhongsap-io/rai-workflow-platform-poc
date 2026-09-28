// PACK-CONTRADICTION (W4b plan section 3.3; provisional until D09). Two documents of one pack must not state the same
// fact both ways: a privacy checklist (slot 2) that says the use case processes no personal data while the BRD
// (slot 5) says it does is a finding for the reviewers, whichever of the two is right.
//
//   - Facts are catalogue params (`params.facts`, seed: `personal_data`, `external_vendor`), each with the slots whose
//     artifacts state it; a claim of the grammar states a fact when its item (`params.items`, keywords by fact ID) is
//     that fact and its answer normalises to `yes` or `no`. `na` and `unknown` answers state nothing.
//   - A fact contradicts when two different artifacts state it with different answers. Two answers inside one
//     artifact are not a pack contradiction (the pack is the unit here, not the document).
//   - One finding per contradicting fact (decision 30): pack scope, `claimKey` = the fact ID, so two contradicting
//     facts are two separately dispositionable findings. Owned by the pack lane of the request's mapping (AI/COE,
//     W0-06 7.1). Evidence: exactly two entries in request (slot) order, the first statement in request order and
//     the first statement of another artifact with the other answer, each with its locator and `excerptHash`.
//     `measure` null; message params `{ fact, slotA, slotB }` (a key and two slot numbers).
//   - Submit only; the runner reads `params.slots` on submit (plan 3.1), and each fact is compared only across its
//     own slots.
import { LANE_MAPPINGS_BY_VERSION, owningLaneRule } from '@rai/shared/constants';
import type { AuthorizedArtifactRef, EvidenceLocation, QcFinding } from '@rai/shared/qc/types';
import { findingKeyOf } from '@rai/shared/qc/validate';
import {
  PackContradictionParamsSchema,
  packContradictionParamsProblems,
  type PackContradictionParams,
} from '@rai/shared/schemas/cases';
import { claimItem, parseClaims, type GrammarClaim } from '../claims.js';
import { excerptHashOf } from '../excerpt.js';
import type { ContentRule, ContentRuleInput } from './rule.js';

interface Statement {
  artifact: AuthorizedArtifactRef;
  claim: GrammarClaim;
  answer: 'yes' | 'no';
}

const evidenceOf = ({ artifact, claim }: Statement): EvidenceLocation => ({
  artifactId: artifact.artifactId,
  contentHash: artifact.contentHash,
  slot: artifact.slot,
  locator: claim.locator,
  excerptHash: excerptHashOf(claim.excerpt),
});

/** The first contradicting pair in request order, or null when every artifact that states the fact agrees. */
function contradiction(statements: readonly Statement[]): [Statement, Statement] | null {
  for (const first of statements) {
    const second = statements.find(
      (other) => other.artifact.artifactId !== first.artifact.artifactId && other.answer !== first.answer,
    );
    if (second !== undefined) return [first, second];
  }
  return null;
}

function evaluate(input: ContentRuleInput): QcFinding[] {
  const { request, rule, documents, provenance } = input;
  const params = input.params as PackContradictionParams; // checked against the schema by the runner
  const pack = owningLaneRule({ kind: 'pack' }, LANE_MAPPINGS_BY_VERSION[request.laneMappingVersion]!);
  if (pack.kind !== 'lane') return []; // the pack always has one lane (W0-06 7.1)

  // Every fact statement of every readable artifact, in request order and document order within one.
  const claimsByArtifact = documents.map((doc) => ({
    artifact: doc.artifact,
    claims: parseClaims(doc.segments, params.labels),
  }));
  const findings: QcFinding[] = [];
  for (const fact of params.facts) {
    const slots = new Set<number>(fact.slots);
    const statements: Statement[] = [];
    for (const { artifact, claims } of claimsByArtifact) {
      if (!slots.has(artifact.slot)) continue;
      for (const claim of claims) {
        if (claim.answer !== 'yes' && claim.answer !== 'no') continue;
        if (claimItem(claim, params.items) !== fact.id) continue;
        statements.push({ artifact, claim, answer: claim.answer });
      }
    }
    const pair = contradiction(statements);
    if (pair === null) continue;
    const [first, second] = pair;
    const scope = { kind: 'pack' as const };
    findings.push({
      findingKey: findingKeyOf(rule.ruleId, scope, fact.id),
      ruleId: rule.ruleId,
      ruleRevision: request.qcRulesRevision,
      trigger: request.trigger,
      scope,
      claimKey: fact.id,
      severity: rule.severity,
      owningLane: pack.lane,
      evidence: [evidenceOf(first), evidenceOf(second)],
      measure: null,
      message: {
        key: 'qc.finding.pack_contradiction',
        params: { fact: fact.id, slotA: first.artifact.slot, slotB: second.artifact.slot },
      },
      provenance: { runner: provenance.runner, runnerVersion: provenance.runnerVersion },
    });
  }
  return findings;
}

export const PACK_CONTRADICTION: ContentRule = Object.freeze({
  triggers: Object.freeze(['submit'] as const),
  paramsSchema: PackContradictionParamsSchema,
  paramsProblems: (params: unknown) => packContradictionParamsProblems(params as PackContradictionParams),
  evaluate,
});
