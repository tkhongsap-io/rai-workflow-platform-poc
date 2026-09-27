// W6-04 (W6 plan section 4.2): the Admin configuration API under `/api/admin/configuration`, over the W6-02 store
// (drafts, publish with a change note, restore) and the W6-03 publish validation. Reads are `config.read_revisions`,
// writes `config.publish`; both rows are Admin only (W0-05, T40), and the middleware answers 401/403 before any handler
// runs, so a non-Admin learns nothing about which kinds or revisions exist. A kind outside `CONFIGURATION_KINDS`, or a
// revision that is malformed, unknown or of another kind, is 404 `configuration`. A moved draft or revision in force
// is 409 `stale_version` `configuration_changed`; every refused body is 422 `invalid_input` with one FieldError per
// problem (a JSON pointer into the configuration body and a `validation.configuration.*` locale key, never the
// problem's prose, which may name values). "Current" is the kind's latest published revision, the same revision the
// store's optimistic checks compare; under the after_publish rule it is in force for every later event.
// Log lines (section 10): `configuration.published` after a publish or restore commits and
// `configuration.publish_refused` on a refused one; no body value, address or note is logged. Audit is the store's.

import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { desc, eq, sql } from 'drizzle-orm';
import { InvalidInputError, NotFoundError, StaleVersionError, type FieldError } from '@rai/shared/errors';
import type { LocaleKey } from '@rai/shared/locales/keys';
import {
  CONFIGURATION_BODY_SCHEMAS,
  CONFIGURATION_KINDS,
  type ConfigurationBodies,
  type ConfigurationKind,
} from '@rai/shared/schemas/cases';
import {
  CONFIGURATION_REVISION_LIST_DEFAULTS,
  CONFIGURATION_VALUES_OWNER,
  ConfigurationDraftDetailSchema,
  ConfigurationDraftResponseSchema,
  ConfigurationIndexResponseSchema,
  ConfigurationKindParamsSchema,
  ConfigurationRevisionDetailSchema,
  ConfigurationRevisionListQuerySchema,
  ConfigurationRevisionListResponseSchema,
  ConfigurationRevisionParamsSchema,
  ConfigurationRevisionSummarySchema,
  DiscardConfigurationDraftRequestSchema,
  PublishConfigurationDraftRequestSchema,
  RestoreConfigurationRevisionRequestSchema,
  SaveConfigurationDraftRequestSchema,
  type ConfigurationDraftDetail,
  type ConfigurationDraftSummary,
  type ConfigurationIndexResponse,
  type ConfigurationRevisionDetail,
  type ConfigurationRevisionSummary,
} from '@rai/shared/schemas/configuration-admin';
import { authorizedActor } from '../authz/middleware.js';
import { readNames, type SubjectDirectory } from '../cases/subject-directory.js';
import type { MailMode } from '../config.js';
import type { Db, Executor } from '../db/client.js';
import { configurationRevision } from '../db/schema/configuration-revision.js';
import { packVersion } from '../db/schema/pack-version.js';
import { withTransaction } from '../db/transaction.js';
import type { Emitter } from '../observability/log.js';
import {
  ConfigurationBodyInvalid,
  ConfigurationChangeNoteInvalid,
  ConfigurationChanged,
  ConfigurationDraftRejected,
  ConfigurationRestoreCurrent,
  ConfigurationRevisionNotFound,
  discardDraft,
  latestRevision,
  publishDraft,
  readDraft,
  readRevisionById,
  restoreRevision,
  saveDraft,
  type ConfigurationDraftRow,
  type ConfigurationRevisionRow,
} from './store.js';
import { PUBLISH_PROBLEM_CODES, publishProblems, type InForceBodies } from './validate.js';

export interface AdminConfigurationRouteDeps {
  db: Db;
  now: () => Date;
  emitter: Emitter;
  /** Names publishers and draft editors on reads (display only). */
  subjects?: SubjectDirectory;
  /** The configured `MAIL_MODE`; absent (the in-process test harness) is treated as a sink by the store (W6-03). */
  mailMode?: MailMode;
}

const BASE = '/api/admin/configuration';
const KIND_SET: ReadonlySet<string> = new Set(CONFIGURATION_KINDS);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `<pointer> <code>: ` at the first W6-03 code; the pointer may hold spaces (a template key such as `v1.0 Sheet3`). */
const CODED_PROBLEM = new RegExp(`^(/.*?) (${PUBLISH_PROBLEM_CODES.join('|')}): `);
const NOT_EDITABLE = new Set(['unknown kind', 'no body schema registered for this kind yet']);

function kindOf(kind: string): ConfigurationKind {
  if (!KIND_SET.has(kind)) throw new NotFoundError('configuration');
  return kind as ConfigurationKind;
}

/**
 * A store problem string → the FieldError served. A W6-03 problem reads `<pointer> <code>: <detail>`; its pointer is
 * kept whole (a template key may hold a space) and its code becomes `validation.configuration.<code>`. A schema
 * problem reads `<pointer> <message>`; only its first pointer segment is kept, because a pointer segment may itself
 * hold a space and the message is never served. A kind without a body schema is `not_editable` at the root.
 */
export function problemFields(problems: readonly string[]): FieldError[] {
  return problems.map((problem) => {
    if (NOT_EDITABLE.has(problem)) return { path: '/', messageKey: 'validation.configuration.not_editable' };
    const coded = CODED_PROBLEM.exec(problem);
    if (coded !== null)
      return {
        path: coded[1]!,
        messageKey: `validation.configuration.${coded[2]}` as LocaleKey,
      };
    const segment = /^\/[^/ ]*/.exec(problem)?.[0] ?? '/';
    return { path: segment, messageKey: 'validation.configuration.schema' };
  });
}

const field = (path: string, messageKey: LocaleKey): InvalidInputError =>
  new InvalidInputError([{ path, messageKey }]);

/** The store's refusals → the W0-06 contract errors; anything else is rethrown (500 via the app's handler). */
function contractError(err: unknown): unknown {
  if (err instanceof ConfigurationChanged)
    return new StaleVersionError({
      reason: 'configuration_changed',
      guidanceKey: 'error.stale_version.guidance.configuration_changed',
      current: { kind: err.kind, ...err.current },
      refreshPath: `/admin/configuration/${err.kind}`,
    });
  if (err instanceof ConfigurationRevisionNotFound) return new NotFoundError('configuration');
  if (err instanceof ConfigurationRestoreCurrent)
    return field('params.revisionId', 'error.invalid_input.restore_current');
  if (err instanceof ConfigurationChangeNoteInvalid)
    return field('body.changeNote', 'validation.configuration.change_note_required');
  if (err instanceof ConfigurationDraftRejected)
    return err.reason === 'base_revision_unknown'
      ? field('body.baseRevisionId', 'validation.configuration.base_revision_unknown')
      : field(
          'body.body',
          err.reason === 'too_large'
            ? 'validation.configuration.draft_too_large'
            : 'validation.configuration.draft_not_object',
        );
  if (err instanceof ConfigurationBodyInvalid) return new InvalidInputError(problemFields(err.problems));
  return err;
}

async function inForceBodies(exec: Executor): Promise<InForceBodies> {
  const [templates, rules] = await Promise.all([
    latestRevision(exec, 'checklist_templates'),
    latestRevision(exec, 'qc_rules'),
  ]);
  return {
    ...(templates === undefined
      ? {}
      : { checklist_templates: templates.body as ConfigurationBodies['checklist_templates'] }),
    ...(rules === undefined ? {} : { qc_rules: rules.body as ConfigurationBodies['qc_rules'] }),
  };
}

/** How many submitted versions froze each revision of `kind` (`pack_version.frozen_configuration ->> kind`). */
async function frozenCounts(exec: Executor, kind: ConfigurationKind, ids: string[]) {
  const counts = new Map<string, number>();
  if (ids.length === 0) return counts;
  const frozen = sql<string>`${packVersion.frozenConfiguration} ->> ${kind}`;
  const rows = await exec
    .select({ id: frozen, n: sql<number>`count(*)::int` })
    .from(packVersion)
    .where(
      sql`${frozen} IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    )
    .groupBy(sql`1`); // by position: the kind is a bound parameter, so a repeated expression would not match
  for (const row of rows) counts.set(row.id, Number(row.n));
  return counts;
}

export function registerAdminConfigurationRoutes(
  fastify: FastifyInstance,
  deps: AdminConfigurationRouteDeps,
): void {
  const app = fastify.withTypeProvider<TypeBoxTypeProvider>();
  const read = { auth: { kind: 'action', action: 'config.read_revisions', target: 'none' } } as const;
  const write = { auth: { kind: 'action', action: 'config.publish', target: 'none' } } as const;

  /** Revision rows → summaries: revision numbers of restored revisions, frozen counts and names in bulk. */
  async function summaries(
    exec: Executor,
    kind: ConfigurationKind,
    rows: ConfigurationRevisionRow[],
    currentId: string | null,
  ): Promise<ConfigurationRevisionSummary[]> {
    const names = readNames(deps.subjects);
    const counts = await frozenCounts(
      exec,
      kind,
      rows.map((r) => r.id),
    );
    const restoredIds = [...new Set(rows.flatMap((r) => (r.restoresId === null ? [] : [r.restoresId])))];
    const restored = new Map<string, number>();
    for (const id of restoredIds) {
      const row = await readRevisionById(exec, id);
      if (row !== undefined) restored.set(id, row.revisionNumber);
    }
    return Promise.all(
      rows.map(async (row) => {
        const name = row.publishedBy === 'system' ? undefined : await names(row.publishedBy);
        return {
          revisionId: row.id,
          kind,
          revisionNumber: row.revisionNumber,
          publishedAt: row.publishedAt.toISOString(),
          publishedBy: row.publishedBy,
          ...(name === undefined ? {} : { publishedByDisplayName: name }),
          changeNote: row.changeNote,
          restoresRevisionNumber: row.restoresId === null ? null : (restored.get(row.restoresId) ?? null),
          inForce: row.id === currentId,
          frozenOnVersionCount: counts.get(row.id) ?? 0,
        };
      }),
    );
  }

  async function draftDetail(exec: Executor, row: ConfigurationDraftRow): Promise<ConfigurationDraftDetail> {
    const problems = problemFields(
      publishProblems(row.kind, row.body, await inForceBodies(exec), deps.mailMode ?? 'sink-file'),
    );
    const name = await readNames(deps.subjects)(row.updatedBy);
    return {
      kind: row.kind,
      baseRevisionId: row.baseRevisionId,
      draftVersion: row.draftVersion,
      updatedBy: row.updatedBy,
      ...(name === undefined ? {} : { updatedByDisplayName: name }),
      updatedAt: row.updatedAt.toISOString(),
      changeNote: row.changeNote,
      problemCount: problems.length,
      body: row.body as Record<string, unknown>,
      problems: problems,
    };
  }

  const draftSummary = ({ body: _b, problems: _p, ...summary }: ConfigurationDraftDetail) =>
    summary satisfies ConfigurationDraftSummary;

  /** Logs a refused publish or restore and rethrows it as its contract error. */
  function refused(kind: ConfigurationKind, err: unknown): never {
    const mapped = contractError(err);
    if (mapped instanceof StaleVersionError)
      deps.emitter.log('configuration.publish_refused', { kind, reason: 'stale', problemCount: 0 });
    else if (mapped instanceof InvalidInputError)
      deps.emitter.log('configuration.publish_refused', {
        kind,
        reason: 'invalid',
        problemCount: mapped.details?.fields.length ?? 0,
      });
    throw mapped;
  }

  function published(row: ConfigurationRevisionRow) {
    deps.emitter.log('configuration.published', {
      kind: row.kind,
      revisionId: row.id,
      revisionNumber: row.revisionNumber,
      ...(row.restoresId === null ? {} : { restoresRevisionId: row.restoresId }),
    });
  }

  const writer = (request: Parameters<typeof authorizedActor>[0]) => {
    const { principal, role } = authorizedActor(request);
    return { actor: { subjectId: principal.subjectId, role }, correlationId: request.id, at: deps.now() };
  };

  // GET /api/admin/configuration → every kind with its owner, current revision and draft.
  app.get(
    BASE,
    { config: read, schema: { response: { 200: ConfigurationIndexResponseSchema } } },
    async (): Promise<ConfigurationIndexResponse> => ({
      kinds: await Promise.all(
        CONFIGURATION_KINDS.map(async (kind) => {
          const [current, draft] = await Promise.all([
            latestRevision(deps.db, kind),
            readDraft(deps.db, kind),
          ]);
          const [summary] =
            current === undefined ? [] : await summaries(deps.db, kind, [current], current.id);
          return {
            kind,
            editable: Object.hasOwn(CONFIGURATION_BODY_SCHEMAS, kind),
            valuesOwner: CONFIGURATION_VALUES_OWNER[kind],
            current: summary ?? null,
            draft: draft === undefined ? null : draftSummary(await draftDetail(deps.db, draft)),
          };
        }),
      ),
    }),
  );

  // GET …/{kind}/revisions?page&pageSize → newest first.
  app.get(
    `${BASE}/:kind/revisions`,
    {
      config: read,
      schema: {
        params: ConfigurationKindParamsSchema,
        querystring: ConfigurationRevisionListQuerySchema,
        response: { 200: ConfigurationRevisionListResponseSchema },
      },
    },
    async (request) => {
      const kind = kindOf(request.params.kind);
      const page = request.query.page ?? CONFIGURATION_REVISION_LIST_DEFAULTS.page;
      const pageSize = request.query.pageSize ?? CONFIGURATION_REVISION_LIST_DEFAULTS.pageSize;
      const [rows, [total], current] = await Promise.all([
        deps.db
          .select()
          .from(configurationRevision)
          .where(eq(configurationRevision.kind, kind))
          .orderBy(desc(configurationRevision.revisionNumber))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        deps.db
          .select({ n: sql<number>`count(*)::int` })
          .from(configurationRevision)
          .where(eq(configurationRevision.kind, kind)),
        latestRevision(deps.db, kind),
      ]);
      return {
        items: await summaries(deps.db, kind, rows as ConfigurationRevisionRow[], current?.id ?? null),
        total: Number(total?.n ?? 0),
      };
    },
  );

  // GET …/{kind}/revisions/{revisionId} → the revision with its body.
  app.get(
    `${BASE}/:kind/revisions/:revisionId`,
    {
      config: read,
      schema: {
        params: ConfigurationRevisionParamsSchema,
        response: { 200: ConfigurationRevisionDetailSchema },
      },
    },
    async (request): Promise<ConfigurationRevisionDetail> => {
      const kind = kindOf(request.params.kind);
      const row = UUID.test(request.params.revisionId)
        ? await readRevisionById(deps.db, request.params.revisionId)
        : undefined;
      if (row?.kind !== kind) throw new NotFoundError('configuration');
      const current = await latestRevision(deps.db, kind);
      const [summary] = await summaries(deps.db, kind, [row], current?.id ?? null);
      return { ...summary!, body: row.body as Record<string, unknown> };
    },
  );

  // GET …/{kind}/draft → the draft with the problems publish would refuse today, or null.
  app.get(
    `${BASE}/:kind/draft`,
    {
      config: read,
      schema: { params: ConfigurationKindParamsSchema, response: { 200: ConfigurationDraftResponseSchema } },
    },
    async (request) => {
      const kind = kindOf(request.params.kind);
      const draft = await readDraft(deps.db, kind);
      return { draft: draft === undefined ? null : await draftDetail(deps.db, draft) };
    },
  );

  // PUT …/{kind}/draft → creates or replaces the draft (any JSON object up to 64 KiB, Q18).
  app.put(
    `${BASE}/:kind/draft`,
    {
      config: write,
      schema: {
        params: ConfigurationKindParamsSchema,
        body: SaveConfigurationDraftRequestSchema,
        response: { 200: ConfigurationDraftDetailSchema },
      },
    },
    async (request) => {
      const kind = kindOf(request.params.kind);
      const { baseRevisionId, expectedDraftVersion, body, changeNote } = request.body;
      try {
        return await withTransaction(deps.db, async (tx) => {
          const saved = await saveDraft(tx, {
            ...writer(request),
            kind,
            baseRevisionId,
            expectedDraftVersion,
            body,
            ...(changeNote === undefined ? {} : { changeNote }),
          });
          return draftDetail(tx, saved);
        });
      } catch (err) {
        throw contractError(err);
      }
    },
  );

  // DELETE …/{kind}/draft → 204.
  app.delete(
    `${BASE}/:kind/draft`,
    {
      config: write,
      schema: { params: ConfigurationKindParamsSchema, body: DiscardConfigurationDraftRequestSchema },
    },
    async (request, reply) => {
      const kind = kindOf(request.params.kind);
      try {
        await withTransaction(deps.db, (tx) =>
          discardDraft(tx, {
            ...writer(request),
            kind,
            expectedDraftVersion: request.body.expectedDraftVersion,
          }),
        );
      } catch (err) {
        throw contractError(err);
      }
      return reply.code(204).send();
    },
  );

  // POST …/{kind}/draft/publish → 201 revision summary.
  app.post(
    `${BASE}/:kind/draft/publish`,
    {
      config: write,
      schema: {
        params: ConfigurationKindParamsSchema,
        body: PublishConfigurationDraftRequestSchema,
        response: { 201: ConfigurationRevisionSummarySchema },
      },
    },
    async (request, reply) => {
      const kind = kindOf(request.params.kind);
      const { expectedDraftVersion, expectedCurrentRevisionId, changeNote } = request.body;
      let row: ConfigurationRevisionRow;
      try {
        row = await withTransaction(deps.db, (tx) =>
          publishDraft(tx, {
            ...writer(request),
            kind,
            expectedDraftVersion,
            expectedCurrentRevisionId,
            ...(changeNote === undefined ? {} : { changeNote }),
            ...(deps.mailMode === undefined ? {} : { mailMode: deps.mailMode }),
          }),
        );
      } catch (err) {
        refused(kind, err);
      }
      published(row);
      const [summary] = await summaries(
        deps.db,
        kind,
        [row],
        (await latestRevision(deps.db, kind))?.id ?? null,
      );
      return reply.code(201).send(summary!);
    },
  );

  // POST …/{kind}/revisions/{revisionId}/restore → 201 revision summary with restoresRevisionNumber.
  app.post(
    `${BASE}/:kind/revisions/:revisionId/restore`,
    {
      config: write,
      schema: {
        params: ConfigurationRevisionParamsSchema,
        body: RestoreConfigurationRevisionRequestSchema,
        response: { 201: ConfigurationRevisionSummarySchema },
      },
    },
    async (request, reply) => {
      const kind = kindOf(request.params.kind);
      let row: ConfigurationRevisionRow;
      try {
        row = await withTransaction(deps.db, (tx) =>
          restoreRevision(tx, {
            ...writer(request),
            kind,
            revisionId: request.params.revisionId,
            expectedCurrentRevisionId: request.body.expectedCurrentRevisionId,
            changeNote: request.body.changeNote,
            ...(deps.mailMode === undefined ? {} : { mailMode: deps.mailMode }),
          }),
        );
      } catch (err) {
        refused(kind, err);
      }
      published(row);
      const [summary] = await summaries(
        deps.db,
        kind,
        [row],
        (await latestRevision(deps.db, kind))?.id ?? null,
      );
      return reply.code(201).send(summary!);
    },
  );
}
