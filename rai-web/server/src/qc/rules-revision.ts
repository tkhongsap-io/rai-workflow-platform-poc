// W4-02 (W4a plan section 3): which `qc_rules` revision a run applies, and its catalogue body.
//   - A submitted version reads the revision frozen on it (`ruleRevisionOf`), never the current one, also when a
//     historical version is re-evaluated.
//   - A draft (the W4-04 upload run) reads the revision the submit freeze would record at that instant: the same
//     activation rule (published strictly before the instant) and the same FK preference (`resolveFrozenConfiguration`).
//   - The revision is loaded by its ID. Only a row of kind `qc_rules` yields a catalogue: a version frozen before
//     W4-02 records a revision of another kind, and an ID with no row names nothing. Both give `catalogue: null`,
//     so the request carries no rules. The recorded `rule_revision` stays the ID in every case.
import { Value } from 'typebox/value';
import type { ModelType, QcTrigger, SelectedRule } from '@rai/shared/qc/types';
import { QcRulesBodySchema, type ConfigurationBodies } from '@rai/shared/schemas/cases';
import type { PackVersionRow } from '../cases/repository.js';
import { readRevisionById } from '../configuration/store.js';
import type { Executor } from '../db/client.js';
import { resolveFrozenConfiguration } from '../versions/freeze.js';
import { revisionsInForce } from '../versions/service.js';
import { ruleRevisionOf } from './repository.js';
import { RuleSelectionError, selectRules } from './select.js';

export interface RuleContext {
  /** The configuration revision ID the run records as `rule_revision` and sends as `qcRulesRevision`. */
  ruleRevision: string;
  /**
   * The catalogue body of that revision as stored (checked against the schema by {@link requestRules}); `null`
   * when the ID names no `qc_rules` revision, so no rules are in force.
   */
  catalogue: ConfigurationBodies['qc_rules'] | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function ruleContextOf(exec: Executor, version: PackVersionRow, at: Date): Promise<RuleContext> {
  const ruleRevision =
    version.submittedAt === null
      ? resolveFrozenConfiguration(await revisionsInForce(exec, at)).configurationRevisionId
      : ruleRevisionOf(version);
  const row = UUID.test(ruleRevision) ? await readRevisionById(exec, ruleRevision) : undefined;
  if (row?.kind !== 'qc_rules') return { ruleRevision, catalogue: null };
  return { ruleRevision, catalogue: row.body as ConfigurationBodies['qc_rules'] };
}

/**
 * `request.rules`: `null` without a catalogue, else the selection for the template, trigger and model type. Throws
 * {@link RuleSelectionError} for an unknown template version, or for a stored body that no longer matches the
 * schema (bodies are validated on write, so such a body can vouch for no rule list).
 */
export function requestRules(
  context: RuleContext,
  templateVersion: string,
  trigger: QcTrigger,
  modelType: ModelType,
): SelectedRule[] | null {
  if (context.catalogue === null) return null;
  if (!Value.Check(QcRulesBodySchema, context.catalogue))
    throw new RuleSelectionError('invalid_rule_catalogue');
  return selectRules(context.catalogue, templateVersion, trigger, modelType);
}
