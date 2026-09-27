// W0-04 `configuration_revision` store: publish (append) and read only. A published revision is immutable: this
// module has no update or delete function, and the migration's trigger plus the missing rai_app grant enforce it
// below the data-access layer. Publishing runs under a per-kind advisory lock, allocates revision_number = max + 1,
// links `supersedes_id` and writes the `configuration.published` audit event in the same transaction.
//
// W6-02 (W6 plan section 2.3) adds the Admin paths on top: one mutable draft per kind (`configuration_draft`, Q1),
// saved, discarded or published under the same per-kind lock with optimistic checks (Q5), a required change note on
// every publish and restore by a person, and restore as a forward-only copy of revision K published as N+1 (Q3).
// The kind's "current" revision for those checks is its latest published revision (highest revision_number): under
// the after_publish rule it is the one in force for every event after its publish instant.

import { and, desc, eq, sql } from 'drizzle-orm';
import { Value } from 'typebox/value';
import { uuidv7 } from '@rai/shared/ids';
import {
  CONFIGURATION_BODY_SCHEMAS,
  CONFIGURATION_KINDS,
  type ConfigurationBodies,
  type ConfigurationKind,
  type ConfigurationView,
  type RiskRubricView,
  type SeedableConfigurationKind,
  qcRulesBodyProblems,
  riskRubricBodyProblems,
} from '@rai/shared/schemas/cases';
import { APP_TIMEZONE } from '@rai/shared/constants';
import { auditStore } from '../audit/store.js';
import {
  CHANGE_NOTE_MAX_LENGTH,
  CONFIGURATION_DRAFT_MAX_BYTES,
} from '@rai/shared/schemas/configuration-admin';
import type { Executor, Tx } from '../db/client.js';
import { configurationDraft } from '../db/schema/configuration-draft.js';
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
  changeNote: string | null; // W6-02: NULL on seed rows
  restoresId: string | null; // W6-02: the revision K a restore copied
}

export interface PublishInput<K extends SeedableConfigurationKind = SeedableConfigurationKind> {
  kind: K;
  body: ConfigurationBodies[K];
  publishedBy: string; // actor subject id ('system' for the seed loader)
  publishedRole: string;
  correlationId: string;
  publishedAt?: Date; // defaults to now; the seed passes an explicit instant so the activation rule is deterministic
  changeNote?: string | null; // W6-02: a person's note (1-500 characters); the seed passes none
  restoresId?: string | null; // W6-02: set by restoreRevision only
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
  if (kind === 'risk_rubric') {
    // W5-02 (W5 plan section 2): duplicate IDs, the reserved option value `unknown`, misordered tier rules.
    const problems = riskRubricBodyProblems(body as ConfigurationBodies['risk_rubric']);
    if (problems.length > 0) throw new ConfigurationBodyInvalid(kind, problems);
  }
}

/** Per-kind advisory lock key (W0-04 "Publish configuration": max + 1 under a per-kind advisory lock). */
function lockKeyFor(kind: string): number {
  let h = 0;
  for (const ch of kind) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
}

/** The per-kind transaction lock every publish and draft write takes (re-entrant within one transaction). */
async function lockKind(tx: Tx, kind: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${lockKeyFor('configuration_revision')}, ${lockKeyFor(kind)})`,
  );
}

export async function publishRevision<K extends SeedableConfigurationKind>(
  tx: Tx,
  input: PublishInput<K>,
): Promise<ConfigurationRevisionRow> {
  validateConfigurationBody(input.kind, input.body);
  if (input.changeNote !== undefined && input.changeNote !== null)
    assertChangeNote(input.kind, input.changeNote);
  await lockKind(tx, input.kind);
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
      changeNote: input.changeNote ?? null,
      restoresId: input.restoresId ?? null,
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
    afterRef:
      published.restoresId === null
        ? { configuration_revision_id: published.id }
        : {
            configuration_revision_id: published.id,
            restores_configuration_revision_id: published.restoresId,
          },
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

// ---- W6-02 Admin drafts, publish and restore (W6 plan section 2.3) ------------------------------------------------

export interface ConfigurationDraftRow {
  kind: ConfigurationKind;
  baseRevisionId: string | null;
  body: unknown;
  changeNote: string | null;
  draftVersion: number;
  updatedBy: string;
  updatedRole: string;
  updatedAt: Date;
}

/** Who acts, for the audit event and the draft's `updated_by`. */
export interface ConfigurationActor {
  subjectId: string;
  role: string;
}

interface AdminWrite {
  actor: ConfigurationActor;
  correlationId: string;
  at?: Date; // defaults to now; tests pass an explicit instant
}

/**
 * The optimistic check failed (Q5): the draft or the kind's current revision is not what the caller last read. W6-04
 * answers 409 `stale_version` `configuration_changed` with `current` as the details' current state.
 */
export class ConfigurationChanged extends Error {
  constructor(
    readonly kind: ConfigurationKind,
    readonly current: { revisionId: string | null; draftVersion: number | null },
  ) {
    super(`configuration ${kind} changed since it was read`);
    this.name = 'ConfigurationChanged';
  }
}

/** A draft body the store never keeps (Q18 admits any JSON object up to 64 KiB), or a base of another kind. 422. */
export class ConfigurationDraftRejected extends Error {
  constructor(
    readonly kind: string,
    readonly reason: 'not_an_object' | 'too_large' | 'base_revision_unknown',
  ) {
    super(`configuration draft for ${kind} refused: ${reason}`);
    this.name = 'ConfigurationDraftRejected';
  }
}

/** A publish or restore by a person needs a change note of 1-500 characters that is not blank (section 2.3). 422. */
export class ConfigurationChangeNoteInvalid extends Error {
  constructor(readonly kind: string) {
    super(`configuration ${kind}: a change note of 1-${CHANGE_NOTE_MAX_LENGTH} characters is required`);
    this.name = 'ConfigurationChangeNoteInvalid';
  }
}

/** The revision to restore is not a revision of this kind (unknown, malformed or of another kind). 404. */
export class ConfigurationRevisionNotFound extends Error {
  constructor(
    readonly kind: string,
    readonly revisionId: string,
  ) {
    super(`configuration ${kind} has no revision ${revisionId}`);
    this.name = 'ConfigurationRevisionNotFound';
  }
}

/** Restoring the revision already in force would publish an identical copy (Q3). 422 `restore_current`. */
export class ConfigurationRestoreCurrent extends Error {
  constructor(
    readonly kind: string,
    readonly revisionId: string,
  ) {
    super(`configuration ${kind} revision ${revisionId} is already in force`);
    this.name = 'ConfigurationRestoreCurrent';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertChangeNote(kind: string, note: string | null | undefined): asserts note is string {
  if (typeof note !== 'string' || note.trim() === '' || note.length > CHANGE_NOTE_MAX_LENGTH)
    throw new ConfigurationChangeNoteInvalid(kind);
}

function assertKnownKind(kind: string): asserts kind is ConfigurationKind {
  if (!KIND_SET.has(kind)) throw new ConfigurationBodyInvalid(kind, ['unknown kind']);
}

/** The kind's latest published revision: the "current" revision of every optimistic check (see the header). */
export async function latestRevision(
  exec: Executor,
  kind: ConfigurationKind,
): Promise<ConfigurationRevisionRow | undefined> {
  const [row] = await exec
    .select()
    .from(configurationRevision)
    .where(eq(configurationRevision.kind, kind))
    .orderBy(desc(configurationRevision.revisionNumber))
    .limit(1);
  return row as ConfigurationRevisionRow | undefined;
}

export async function readDraft(
  exec: Executor,
  kind: ConfigurationKind,
): Promise<ConfigurationDraftRow | undefined> {
  const [row] = await exec
    .select()
    .from(configurationDraft)
    .where(eq(configurationDraft.kind, kind))
    .limit(1);
  return row as ConfigurationDraftRow | undefined;
}

/** Under the kind lock: the draft (locked for this transaction) and the current revision. */
async function lockedState(tx: Tx, kind: ConfigurationKind) {
  await lockKind(tx, kind);
  const [draftRow] = await tx
    .select()
    .from(configurationDraft)
    .where(eq(configurationDraft.kind, kind))
    .for('update')
    .limit(1);
  const draft = draftRow as ConfigurationDraftRow | undefined;
  const current = await latestRevision(tx, kind);
  const changed = () =>
    new ConfigurationChanged(kind, {
      revisionId: current?.id ?? null,
      draftVersion: draft?.draftVersion ?? null,
    });
  return { draft, current, changed };
}

export interface SaveDraftInput extends AdminWrite {
  kind: ConfigurationKind;
  baseRevisionId: string | null; // the revision the Admin started from (null before any publish)
  expectedDraftVersion: number | null; // null creates; a number updates that version
  body: Record<string, unknown>;
  changeNote?: string;
}

/**
 * `PUT …/{kind}/draft` (W6-04): creates or replaces the kind's draft. Any JSON object up to 64 KiB is kept (Q18);
 * publish, not save, refuses an invalid body. Audits `configuration.draft_saved`.
 */
export async function saveDraft(tx: Tx, input: SaveDraftInput): Promise<ConfigurationDraftRow> {
  assertKnownKind(input.kind);
  const body: unknown = input.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    throw new ConfigurationDraftRejected(input.kind, 'not_an_object');
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > CONFIGURATION_DRAFT_MAX_BYTES)
    throw new ConfigurationDraftRejected(input.kind, 'too_large');
  if (input.changeNote !== undefined) assertChangeNote(input.kind, input.changeNote);
  if (input.baseRevisionId !== null) {
    const baseRow = UUID.test(input.baseRevisionId)
      ? await readRevisionById(tx, input.baseRevisionId)
      : undefined;
    if (baseRow?.kind !== input.kind)
      throw new ConfigurationDraftRejected(input.kind, 'base_revision_unknown');
  }
  const { draft, changed } = await lockedState(tx, input.kind);
  if (
    input.expectedDraftVersion === null
      ? draft !== undefined
      : draft?.draftVersion !== input.expectedDraftVersion
  )
    throw changed();
  const at = input.at ?? new Date();
  const values = {
    baseRevisionId: input.baseRevisionId,
    body,
    changeNote: input.changeNote ?? null,
    draftVersion: (draft?.draftVersion ?? 0) + 1,
    updatedBy: input.actor.subjectId,
    updatedRole: input.actor.role,
    updatedAt: at,
  };
  const [row] =
    draft === undefined
      ? await tx
          .insert(configurationDraft)
          .values({ kind: input.kind, ...values })
          .returning()
      : await tx
          .update(configurationDraft)
          .set(values)
          .where(eq(configurationDraft.kind, input.kind))
          .returning();
  const saved = row as ConfigurationDraftRow;
  await auditStore.append(tx, {
    actorSubjectId: input.actor.subjectId,
    actorRole: input.actor.role,
    action: 'configuration.draft_saved',
    targetRef: { kind: input.kind, draft_version: saved.draftVersion },
    beforeRef: draft === undefined ? null : { draft_version: draft.draftVersion },
    afterRef: { draft_version: saved.draftVersion, base_configuration_revision_id: saved.baseRevisionId },
    correlationId: input.correlationId,
    occurredAt: at,
  });
  return saved;
}

export interface DiscardDraftInput extends AdminWrite {
  kind: ConfigurationKind;
  expectedDraftVersion: number;
}

/** `DELETE …/{kind}/draft` (W6-04): removes the draft at that version. Audits `configuration.draft_discarded`. */
export async function discardDraft(tx: Tx, input: DiscardDraftInput): Promise<void> {
  assertKnownKind(input.kind);
  const { draft, changed } = await lockedState(tx, input.kind);
  if (draft === undefined || draft.draftVersion !== input.expectedDraftVersion) throw changed();
  await tx.delete(configurationDraft).where(eq(configurationDraft.kind, input.kind));
  const at = input.at ?? new Date();
  await auditStore.append(tx, {
    actorSubjectId: input.actor.subjectId,
    actorRole: input.actor.role,
    action: 'configuration.draft_discarded',
    targetRef: { kind: input.kind, draft_version: draft.draftVersion },
    beforeRef: { draft_version: draft.draftVersion, base_configuration_revision_id: draft.baseRevisionId },
    afterRef: null,
    correlationId: input.correlationId,
    occurredAt: at,
  });
}

export interface PublishDraftInput extends AdminWrite {
  kind: ConfigurationKind;
  expectedDraftVersion: number;
  expectedCurrentRevisionId: string | null;
  changeNote?: string; // the publish dialog's note; otherwise the draft's
}

/**
 * `POST …/{kind}/draft/publish` (W6-04), one transaction (section 2.3): the kind lock; the draft version and "the
 * current revision is still both the caller's and the draft's base" (else `ConfigurationChanged`); a change note;
 * validation; `publishRevision` with the note (which audits `configuration.published`); the draft deleted. W6-03 adds
 * the cross-kind `publishProblems` here; the seed and fixtures keep calling `publishRevision` directly.
 */
export async function publishDraft(tx: Tx, input: PublishDraftInput): Promise<ConfigurationRevisionRow> {
  assertKnownKind(input.kind);
  const { draft, current, changed } = await lockedState(tx, input.kind);
  const currentId = current?.id ?? null;
  if (
    draft === undefined ||
    draft.draftVersion !== input.expectedDraftVersion ||
    input.expectedCurrentRevisionId !== currentId ||
    draft.baseRevisionId !== currentId
  )
    throw changed();
  const changeNote = input.changeNote ?? draft.changeNote;
  assertChangeNote(input.kind, changeNote);
  validateConfigurationBody(input.kind, draft.body);
  const published = await publishRevision(tx, {
    kind: input.kind as SeedableConfigurationKind,
    body: draft.body,
    publishedBy: input.actor.subjectId,
    publishedRole: input.actor.role,
    correlationId: input.correlationId,
    publishedAt: input.at ?? new Date(),
    changeNote,
  });
  await tx.delete(configurationDraft).where(eq(configurationDraft.kind, input.kind));
  return published;
}

export interface RestoreRevisionInput extends AdminWrite {
  kind: ConfigurationKind;
  revisionId: string; // revision K
  expectedCurrentRevisionId: string;
  changeNote: string;
}

/**
 * `POST …/{kind}/revisions/{revisionId}/restore` (W6-04, Q3): publishes a copy of revision K's body as N+1 with
 * `restores_id = K`, under the same lock and validation as a publish. Refused when K is not of this kind (404), when
 * the current revision moved (409) and when K is the current revision (422 `restore_current`). A draft of the kind is
 * kept; its base is now stale, so the SPA offers to discard it or start again from current.
 */
export async function restoreRevision(
  tx: Tx,
  input: RestoreRevisionInput,
): Promise<ConfigurationRevisionRow> {
  assertKnownKind(input.kind);
  const target = UUID.test(input.revisionId) ? await readRevisionById(tx, input.revisionId) : undefined;
  if (target?.kind !== input.kind) throw new ConfigurationRevisionNotFound(input.kind, input.revisionId);
  const { current, changed } = await lockedState(tx, input.kind);
  if (input.expectedCurrentRevisionId !== (current?.id ?? null)) throw changed();
  if (target.id === current?.id) throw new ConfigurationRestoreCurrent(input.kind, target.id);
  assertChangeNote(input.kind, input.changeNote);
  validateConfigurationBody(input.kind, target.body);
  return publishRevision(tx, {
    kind: input.kind as SeedableConfigurationKind,
    body: target.body,
    publishedBy: input.actor.subjectId,
    publishedRole: input.actor.role,
    correlationId: input.correlationId,
    publishedAt: input.at ?? new Date(),
    changeNote: input.changeNote,
    restoresId: target.id,
  });
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

/**
 * W5-02 (W5 plan section 6): the `risk_rubric` revision in force at `at` as the `GET
 * /api/configuration/risk-rubric/current` view, or undefined when none is (the route answers 404 `risk_rubric`).
 */
export async function currentRiskRubric(
  exec: Executor,
  at: Date = new Date(),
): Promise<RiskRubricView | undefined> {
  const row = await currentRevision(exec, 'risk_rubric', at);
  if (row === undefined) return undefined;
  const body = row.body as ConfigurationBodies['risk_rubric'];
  return {
    revisionId: row.id,
    label: body.label,
    provenance: body.provenance,
    publishedAt: row.publishedAt.toISOString(),
    body,
  };
}
