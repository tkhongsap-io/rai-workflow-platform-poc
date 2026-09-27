// W0-04 `configuration_revision` store: publish (append) and read only. A published revision is immutable: this
// module has no update or delete function, and the migration's trigger plus the missing rai_app grant enforce it
// below the data-access layer. Publishing runs under a per-kind advisory lock, allocates revision_number = max + 1,
// links `supersedes_id` and writes the `configuration.published` audit event in the same transaction.

import { and, desc, eq, sql } from 'drizzle-orm';
import { Value } from 'typebox/value';
import { uuidv7 } from '@rai/shared/ids';
import {
  CONFIGURATION_BODY_SCHEMAS,
  CONFIGURATION_KINDS,
  type ConfigurationBodies,
  type ConfigurationKind,
  type ConfigurationView,
  type SeedableConfigurationKind,
  qcRulesBodyProblems,
} from '@rai/shared/schemas/cases';
import { APP_TIMEZONE } from '@rai/shared/constants';
import { auditStore } from '../audit/store.js';
import type { Executor, Tx } from '../db/client.js';
import { configurationRevision } from '../db/schema/configuration-revision.js';
import { revisionInForce } from './activation.js';

export interface ConfigurationRevisionRow {
  id: string;
  kind: ConfigurationKind;
  revisionNumber: number;
  body: unknown;
  publishedBy: string;
  publishedAt: Date;
  activationRule: 'after_publish';
  supersedesId: string | null;
}

export interface PublishInput<K extends SeedableConfigurationKind = SeedableConfigurationKind> {
  kind: K;
  body: ConfigurationBodies[K];
  publishedBy: string; // actor subject id ('system' for the seed loader)
  publishedRole: string;
  correlationId: string;
  publishedAt?: Date; // defaults to now; the seed passes an explicit instant so the activation rule is deterministic
}

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
}

/** Per-kind advisory lock key (W0-04 "Publish configuration": max + 1 under a per-kind advisory lock). */
function lockKeyFor(kind: string): number {
  let h = 0;
  for (const ch of kind) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
}

export async function publishRevision<K extends SeedableConfigurationKind>(
  tx: Tx,
  input: PublishInput<K>,
): Promise<ConfigurationRevisionRow> {
  validateConfigurationBody(input.kind, input.body);
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${lockKeyFor('configuration_revision')}, ${lockKeyFor(input.kind)})`,
  );
  const [previous] = await tx
    .select({ id: configurationRevision.id, revisionNumber: configurationRevision.revisionNumber })
    .from(configurationRevision)
    .where(eq(configurationRevision.kind, input.kind))
    .orderBy(desc(configurationRevision.revisionNumber))
    .limit(1);
  const publishedAt = input.publishedAt ?? new Date();
  const [row] = await tx
    .insert(configurationRevision)
    .values({
      id: uuidv7(publishedAt.getTime()),
      kind: input.kind,
      revisionNumber: (previous?.revisionNumber ?? 0) + 1,
      body: input.body,
      publishedBy: input.publishedBy,
      publishedAt,
      activationRule: 'after_publish',
      supersedesId: previous?.id ?? null,
    })
    .returning();
  const published = row as ConfigurationRevisionRow;
  await auditStore.append(tx, {
    actorSubjectId: input.publishedBy,
    actorRole: input.publishedRole,
    action: 'configuration.published',
    targetRef: {
      configuration_revision_id: published.id,
      kind: published.kind,
      revision_number: published.revisionNumber,
    },
    beforeRef: previous === undefined ? null : { configuration_revision_id: previous.id },
    afterRef: { configuration_revision_id: published.id },
    correlationId: input.correlationId,
    occurredAt: publishedAt,
  });
  return published;
}

export async function readRevisionById(
  exec: Executor,
  id: string,
): Promise<ConfigurationRevisionRow | undefined> {
  const [row] = await exec
    .select()
    .from(configurationRevision)
    .where(eq(configurationRevision.id, id))
    .limit(1);
  return row as ConfigurationRevisionRow | undefined;
}

export async function listRevisions(
  exec: Executor,
  kind: ConfigurationKind,
): Promise<ConfigurationRevisionRow[]> {
  const rows = await exec
    .select()
    .from(configurationRevision)
    .where(eq(configurationRevision.kind, kind))
    .orderBy(desc(configurationRevision.revisionNumber));
  return rows as ConfigurationRevisionRow[];
}

/** The revision of `kind` in force at `at` under the activation rule (provisional: published strictly before `at`). */
export async function currentRevision(
  exec: Executor,
  kind: ConfigurationKind,
  at: Date = new Date(),
): Promise<ConfigurationRevisionRow | undefined> {
  const rows = await exec
    .select()
    .from(configurationRevision)
    .where(and(eq(configurationRevision.kind, kind), sql`${configurationRevision.publishedAt} < ${at}`))
    .orderBy(desc(configurationRevision.publishedAt), desc(configurationRevision.revisionNumber))
    .limit(1);
  return revisionInForce(rows as ConfigurationRevisionRow[], at);
}

export async function currentBody<K extends SeedableConfigurationKind>(
  exec: Executor,
  kind: K,
  at: Date = new Date(),
): Promise<ConfigurationBodies[K] | undefined> {
  const row = await currentRevision(exec, kind, at);
  return row?.body as ConfigurationBodies[K] | undefined;
}

export class ConfigurationMissing extends Error {
  constructor(readonly kind: ConfigurationKind) {
    super(`no published ${kind} configuration revision applies`);
    this.name = 'ConfigurationMissing';
  }
}

/** The W0-02 7.3 ConfigurationView (`GET /api/configuration/current`, W1-02): every kind in force at `at`. */
export async function effectiveConfiguration(
  exec: Executor,
  at: Date = new Date(),
): Promise<ConfigurationView> {
  const [groups, templates, slaRow] = await Promise.all([
    currentRevision(exec, 'use_case_groups', at),
    currentRevision(exec, 'checklist_templates', at),
    currentRevision(exec, 'sla', at),
  ]);
  if (groups === undefined) throw new ConfigurationMissing('use_case_groups');
  if (templates === undefined) throw new ConfigurationMissing('checklist_templates');
  if (slaRow === undefined) throw new ConfigurationMissing('sla');
  const sla = slaRow.body as ConfigurationBodies['sla'];
  const latest = [groups, templates, slaRow].reduce((a, b) => (a.publishedAt >= b.publishedAt ? a : b));
  return {
    revisionId: latest.id,
    publishedAt: latest.publishedAt.toISOString(),
    useCaseGroups: (groups.body as ConfigurationBodies['use_case_groups']).groups,
    checklistTemplateVersions: (templates.body as ConfigurationBodies['checklist_templates']).versions,
    slaWorkingDays: { ai_coe: sla.ai_coe, dpo: sla.dpo, it_security: sla.it_security },
    timezone: APP_TIMEZONE,
  };
}
