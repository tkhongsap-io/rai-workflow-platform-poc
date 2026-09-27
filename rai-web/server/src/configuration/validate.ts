// Configuration body validation.
//
// `validateConfigurationBody` is the per-kind schema check every publish runs (W1-00; W4-02 `qcRulesBodyProblems`;
// W5-02 `risk_rubric`). It moved here from store.ts unchanged in W6-03 (store.ts re-exports it) so that store.ts can
// call `publishProblems` without an import cycle.
//
// `publishProblems` (W6-03, W6 plan section 2.4) is the full check of the Admin paths only: `publishDraft` and
// `restoreRevision` call it inside their transaction. `publishRevision`, which the seed, `fixtures:load` and several
// integration suites call directly, keeps only `validateConfigurationBody`: the seed publishes `checklist_templates`
// before `qc_rules`, `w4-02-rule-catalogue` publishes a partial catalogue on purpose and `w3-03b-digest` a real
// recipient on purpose. Pure: the revisions in force and the mail mode are passed in; no I/O, no clock.

import { Value } from 'typebox/value';
import { IMPLEMENTED_RULES } from '@rai/shared/qc/rule-registry';
import {
  CONFIGURATION_BODY_SCHEMAS,
  CONFIGURATION_KINDS,
  type ConfigurationBodies,
  type SeedableConfigurationKind,
  qcRulesBodyProblems,
  riskRubricBodyProblems,
} from '@rai/shared/schemas/cases';
import type { MailMode } from '../config.js';
import { syntheticAddress } from '../notifications/compose.js';

export class ConfigurationBodyInvalid extends Error {
  constructor(
    readonly kind: string,
    readonly problems: string[],
  ) {
    super(`configuration body for ${kind} is invalid: ${problems.join('; ')}`);
    this.name = 'ConfigurationBodyInvalid';
  }
}

const KIND_SET: ReadonlySet<string> = new Set(CONFIGURATION_KINDS);

/** Validates a body against the shared schema for its kind. A kind without a schema cannot be published. */
export function validateConfigurationBody(
  kind: string,
  body: unknown,
): asserts body is ConfigurationBodies[SeedableConfigurationKind] {
  if (!KIND_SET.has(kind)) throw new ConfigurationBodyInvalid(kind, ['unknown kind']);
  const schema = (CONFIGURATION_BODY_SCHEMAS as Record<string, unknown>)[kind];
  if (schema === undefined)
    throw new ConfigurationBodyInvalid(kind, ['no body schema registered for this kind yet']);
  if (!Value.Check(schema as Parameters<typeof Value.Check>[0], body)) {
    const problems = [...Value.Errors(schema as Parameters<typeof Value.Check>[0], body)].map(
      (e) => `${e.instancePath || '/'} ${e.message}`,
    );
    throw new ConfigurationBodyInvalid(kind, problems);
  }
  if (kind === 'qc_rules') {
    // W4-02: the catalogue checks the schema cannot express (a rule listed twice, params per rule ID).
    const problems = qcRulesBodyProblems(body as ConfigurationBodies['qc_rules']);
    if (problems.length > 0) throw new ConfigurationBodyInvalid(kind, problems);
  }
  if (kind === 'risk_rubric') {
    // W5-02 (W5 plan section 2): duplicate IDs, the reserved option value `unknown`, misordered tier rules.
    const problems = riskRubricBodyProblems(body as ConfigurationBodies['risk_rubric']);
    if (problems.length > 0) throw new ConfigurationBodyInvalid(kind, problems);
  }
}

/**
 * The code after the JSON pointer of every cross-kind problem (`<pointer> <code>: <detail>`). W6-04 answers 422
 * `invalid_input` with the pointer as the field and `validation.configuration.<code>` as its locale key.
 */
export const PUBLISH_PROBLEM_CODES = [
  'rule_not_implemented',
  'rule_engine_mismatch',
  'rule_trigger_not_implemented',
  'rule_template_isolated',
  'catalogue_missing_template',
  'template_not_in_catalogue',
  'recipient_not_synthetic',
] as const;
export type PublishProblemCode = (typeof PUBLISH_PROBLEM_CODES)[number];

/** The bodies of the revisions in force that the cross-kind checks read (the kind's latest published revision). */
export type InForceBodies = Partial<{ [K in SeedableConfigurationKind]: ConfigurationBodies[K] }>;

/** The mail modes that keep every message in a sink; while one is configured, recipients must be synthetic. */
const SINK_MAIL_MODES: ReadonlySet<MailMode> = new Set<MailMode>(['sink-file', 'sink-memory']);

/** RFC 6901 pointer from path segments (`~` as `~0`, `/` as `~1`). */
const pointer = (...segments: Array<string | number>) =>
  segments.map((s) => `/${String(s).replaceAll('~', '~0').replaceAll('/', '~1')}`).join('');

const problem = (at: string, code: PublishProblemCode, detail: string) => `${at} ${code}: ${detail}`;

function qcRulesProblems(body: ConfigurationBodies['qc_rules'], inForce: InForceBodies): string[] {
  const problems: string[] = [];
  for (const [template, { rules }] of Object.entries(body.templates)) {
    rules.forEach((entry, index) => {
      const at = pointer('templates', template, 'rules', index);
      const known = Object.hasOwn(IMPLEMENTED_RULES, entry.ruleId)
        ? IMPLEMENTED_RULES[entry.ruleId]
        : undefined;
      if (known === undefined) {
        problems.push(
          problem(at, 'rule_not_implemented', `${entry.ruleId} is not a rule the product implements`),
        );
        return;
      }
      if (entry.engine !== known.engine)
        problems.push(
          problem(
            at,
            'rule_engine_mismatch',
            `${entry.ruleId} is a ${known.engine} rule, not ${entry.engine}`,
          ),
        );
      const extra = entry.triggers.filter((trigger) => !known.triggers.includes(trigger));
      if (extra.length > 0)
        problems.push(
          problem(
            at,
            'rule_trigger_not_implemented',
            `${entry.ruleId} is not defined for ${extra.join(', ')} (only ${known.triggers.join(', ')})`,
          ),
        );
      if (known.templates !== undefined && !known.templates.includes(template))
        problems.push(
          problem(
            at,
            'rule_template_isolated',
            `${entry.ruleId} applies only to ${known.templates.join(', ')}, not ${template}`,
          ),
        );
    });
  }
  const versions = inForce.checklist_templates?.versions ?? [];
  const missing = versions.filter((version) => !Object.hasOwn(body.templates, version));
  if (missing.length > 0)
    problems.push(
      problem(
        pointer('templates'),
        'catalogue_missing_template',
        `no entry for ${missing.join(', ')}, listed in the checklist_templates revision in force`,
      ),
    );
  return problems;
}

function checklistTemplatesProblems(
  body: ConfigurationBodies['checklist_templates'],
  inForce: InForceBodies,
): string[] {
  const catalogue = inForce.qc_rules?.templates ?? {};
  const problems: string[] = [];
  body.versions.forEach((version, index) => {
    if (!Object.hasOwn(catalogue, version))
      problems.push(
        problem(
          pointer('versions', index),
          'template_not_in_catalogue',
          `${version} has no entry in the qc_rules revision in force; publish qc_rules first`,
        ),
      );
  });
  return problems;
}

function operatorRecipientsProblems(
  body: ConfigurationBodies['operator_recipients'],
  mailMode: MailMode,
): string[] {
  if (!SINK_MAIL_MODES.has(mailMode)) return [];
  const problems: string[] = [];
  body.addresses.forEach((address, index) => {
    // Synthetic only while mail is a sink (D08, W7): the digest's own rule, narrowed to the .example and .test
    // domains the plan names. The detail never echoes the address.
    if (!syntheticAddress(address) || !/\.(?:example|test)$/i.test(address))
      problems.push(
        problem(
          pointer('addresses', index),
          'recipient_not_synthetic',
          'only a synthetic address on a .example or .test domain may be published while mail is a sink',
        ),
      );
  });
  return problems;
}

/**
 * Every reason the Admin may not publish `body` as the next revision of `kind` (W6 plan section 2.4); empty when it
 * may. The schema check runs first and alone: the cross-kind checks need a valid body. `inForce` holds the bodies of
 * the kinds' revisions in force (`checklist_templates` and `qc_rules` are read); `mailMode` is the configured
 * `MAIL_MODE`.
 */
export function publishProblems(
  kind: string,
  body: unknown,
  inForce: InForceBodies,
  mailMode: MailMode,
): string[] {
  try {
    validateConfigurationBody(kind, body);
  } catch (err) {
    if (err instanceof ConfigurationBodyInvalid) return err.problems;
    throw err;
  }
  switch (kind) {
    case 'qc_rules':
      return qcRulesProblems(body as ConfigurationBodies['qc_rules'], inForce);
    case 'checklist_templates':
      return checklistTemplatesProblems(body as ConfigurationBodies['checklist_templates'], inForce);
    case 'operator_recipients':
      return operatorRecipientsProblems(body as ConfigurationBodies['operator_recipients'], mailMode);
    default:
      return [];
  }
}
