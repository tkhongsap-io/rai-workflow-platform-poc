// W6-04 (W6 plan section 4.2, row W6-04): the Admin configuration API on real Postgres through the authenticated
// handlers of the in-process fixture app. Index, history (newest first, frozen-on-version counts), revision detail,
// draft read/save/discard, publish and restore over the W6-02/W6-03 store; 404 `configuration`, 409
// `configuration_changed`, 422 with every problem as a FieldError; audit rows; the `configuration.published` and
// `configuration.publish_refused` log lines; and T40: every non-Admin fixture identity is 403 on every route.
// Synthetic values only.

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Value } from 'typebox/value';
import type { ErrorResponse } from '@rai/shared/errors';
import { CONFIGURATION_KINDS } from '@rai/shared/schemas/cases';
import {
  CONFIGURATION_DRAFT_MAX_BYTES,
  ConfigurationDraftDetailSchema,
  ConfigurationIndexResponseSchema,
  ConfigurationRevisionDetailSchema,
  ConfigurationRevisionListResponseSchema,
  ConfigurationRevisionSummarySchema,
  type ConfigurationDraftDetail,
  type ConfigurationIndexResponse,
  type ConfigurationRevisionDetail,
  type ConfigurationRevisionSummary,
} from '@rai/shared/schemas/configuration-admin';
import { isLocaleKey } from '@rai/shared/locales/keys';
import { CONFIGURATION_SEED } from '@rai/server/configuration/seed';
import { FIXTURE_USERS } from '@rai/fixtures/data/users';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import { app, capture, db, openFixtureApp, signIn, submitOk } from '../support/fixture-app.js';
import { asUser, type FixtureSession } from '../support/sign-in.js';
import { assertNoLeak } from '../support/log-capture.js';

const ADMIN = 'fx-user-admin';
const OWNER = 'fx-user-owner-cm';
const BASE = '/api/admin/configuration';
const START = new Date('2026-09-28T03:00:00.000Z').getTime();
let clock = START;
const now = () => new Date(clock);
/** Moves the app clock on, so a revision published at the previous instant is in force for the next event. */
const advance = (ms = 60_000) => {
  clock += ms;
};
beforeEach(() => {
  clock = START;
});
openFixtureApp({ now });

type Json = Record<string, unknown>;

async function call(
  session: FixtureSession | null,
  method: 'GET' | 'PUT' | 'POST' | 'DELETE',
  url: string,
  payload?: Json,
) {
  return app.inject({
    method,
    url,
    headers: {
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      ...(session === null ? { 'sec-fetch-site': 'same-origin' } : asUser(session)),
    },
    ...(payload === undefined ? {} : { payload }),
  });
}

async function index(admin: FixtureSession): Promise<ConfigurationIndexResponse> {
  const res = await call(admin, 'GET', BASE);
  assert.equal(res.statusCode, 200, res.body);
  const body: unknown = res.json();
  assert.ok(Value.Check(ConfigurationIndexResponseSchema, body), res.body.slice(0, 400));
  return body;
}

const entry = (i: ConfigurationIndexResponse, kind: string) => i.kinds.find((k) => k.kind === kind)!;

async function saveDraft(
  admin: FixtureSession,
  kind: string,
  body: Json,
  opts: { base?: string | null; expected?: number | null; changeNote?: string } = {},
) {
  const i = await index(admin);
  const current = entry(i, kind);
  return call(admin, 'PUT', `${BASE}/${kind}/draft`, {
    baseRevisionId: opts.base === undefined ? (current.current?.revisionId ?? null) : opts.base,
    expectedDraftVersion: opts.expected === undefined ? (current.draft?.draftVersion ?? null) : opts.expected,
    body,
    ...(opts.changeNote === undefined ? {} : { changeNote: opts.changeNote }),
  });
}

async function saveOk(admin: FixtureSession, kind: string, body: Json, changeNote?: string) {
  const res = await saveDraft(admin, kind, body, changeNote === undefined ? {} : { changeNote });
  assert.equal(res.statusCode, 200, res.body);
  const draft: unknown = res.json();
  assert.ok(Value.Check(ConfigurationDraftDetailSchema, draft), res.body.slice(0, 400));
  return draft;
}

async function publish(admin: FixtureSession, kind: string, changeNote?: string) {
  const i = entry(await index(admin), kind);
  return call(admin, 'POST', `${BASE}/${kind}/draft/publish`, {
    expectedDraftVersion: i.draft!.draftVersion,
    expectedCurrentRevisionId: i.current?.revisionId ?? null,
    ...(changeNote === undefined ? {} : { changeNote }),
  });
}

async function publishOk(admin: FixtureSession, kind: string, body: Json, changeNote = 'synthetic change') {
  await saveOk(admin, kind, body);
  const res = await publish(admin, kind, changeNote);
  assert.equal(res.statusCode, 201, res.body);
  const summary: unknown = res.json();
  assert.ok(Value.Check(ConfigurationRevisionSummarySchema, summary), res.body);
  return summary;
}

async function revisions(admin: FixtureSession, kind: string, query = '') {
  const res = await call(admin, 'GET', `${BASE}/${kind}/revisions${query}`);
  assert.equal(res.statusCode, 200, res.body);
  const body: unknown = res.json();
  assert.ok(Value.Check(ConfigurationRevisionListResponseSchema, body), res.body.slice(0, 400));
  return body;
}

async function auditRows(action: string) {
  const r = await db.owner.execute(
    sql`SELECT action, actor_subject_id, actor_role, target_ref, before_ref, after_ref, correlation_id
        FROM audit_event WHERE action = ${action} ORDER BY occurred_at, id`,
  );
  return r.rows as Array<{
    action: string;
    actor_subject_id: string;
    actor_role: string;
    target_ref: Json;
    before_ref: Json | null;
    after_ref: Json | null;
    correlation_id: string;
  }>;
}

const events = (name: string) => capture.lines().filter((line) => line.event === name);

function expectError<C extends string>(res: { statusCode: number; body: string }, status: number, code: C) {
  assert.equal(res.statusCode, status, res.body);
  const body = JSON.parse(res.body) as ErrorResponse;
  assert.equal(body.error.code, code, res.body);
  return body.error;
}

describe('reads', () => {
  it('the index lists every kind in order with its owner, editability, current revision and no draft', async () => {
    const admin = await signIn(ADMIN);
    const i = await index(admin);
    assert.deepEqual(
      i.kinds.map((k) => k.kind),
      [...CONFIGURATION_KINDS],
    );
    const owners = Object.fromEntries(i.kinds.map((k) => [k.kind, k.valuesOwner]));
    assert.equal(owners.risk_rubric, 'D07');
    assert.equal(owners.group_role_mapping, 'D10');
    assert.equal(owners.sla, 'admin');
    assert.equal(entry(i, 'group_role_mapping').editable, false); // no body schema until W6-11
    assert.equal(entry(i, 'group_role_mapping').current, null);
    for (const kind of Object.keys(CONFIGURATION_SEED)) {
      const e = entry(i, kind);
      assert.equal(e.editable, true, kind);
      assert.equal(e.draft, null, kind);
      assert.equal(e.current?.revisionNumber, 1, kind);
      assert.equal(e.current?.inForce, true, kind);
      assert.equal(e.current?.changeNote, null, kind); // seed rows carry no note
      assert.equal(e.current?.publishedBy, 'system', kind);
    }
  });

  it('history is newest first with change notes, restores and frozen-on-version counts; paging and detail', async () => {
    const admin = await signIn(ADMIN);
    const seedSla = entry(await index(admin), 'sla').current!;
    const owner = await signIn(OWNER);
    const caseId = await firstDraftCaseId();
    await submitOk(owner, caseId); // freezes seed sla (and every other kind) on one more version
    const before = (await revisions(admin, 'sla')).items[0]!;
    assert.equal(before.revisionId, seedSla.revisionId);
    assert.ok(before.frozenOnVersionCount >= 1, 'the submit froze the seed sla');
    const frozenCount = await frozenCountFor('sla', seedSla.revisionId);
    assert.equal(before.frozenOnVersionCount, frozenCount);

    advance();
    const r2 = await publishOk(
      admin,
      'sla',
      { dpo: 4, ai_coe: 5, it_security: 5 },
      'DPO four days (synthetic)',
    );
    assert.equal(r2.revisionNumber, 2);
    assert.equal(r2.changeNote, 'DPO four days (synthetic)');
    assert.equal(r2.inForce, true);
    assert.equal(r2.frozenOnVersionCount, 0);
    assert.equal(r2.restoresRevisionNumber, null);
    assert.equal(r2.publishedBy, FIXTURE_USERS.find((u) => u.fixtureUserId === ADMIN)!.subjectId);
    assert.equal(typeof r2.publishedByDisplayName, 'string');

    const list = await revisions(admin, 'sla');
    assert.equal(list.total, 2);
    assert.deepEqual(
      list.items.map((r) => [r.revisionNumber, r.inForce]),
      [
        [2, true],
        [1, false],
      ],
    );
    const page2 = await revisions(admin, 'sla', '?page=2&pageSize=1');
    assert.equal(page2.total, 2);
    assert.deepEqual(
      page2.items.map((r) => r.revisionNumber),
      [1],
    );

    const detail = await call(admin, 'GET', `${BASE}/sla/revisions/${seedSla.revisionId}`);
    assert.equal(detail.statusCode, 200, detail.body);
    const d: unknown = detail.json();
    assert.ok(Value.Check(ConfigurationRevisionDetailSchema, d), detail.body);
    assert.deepEqual(d.body, CONFIGURATION_SEED.sla);
    assert.equal(d.inForce, false);

    const bad = await call(admin, 'GET', `${BASE}/sla/revisions?pageSize=101`);
    expectError(bad, 422, 'invalid_input');
  });

  it('404 configuration for an unknown kind and for a malformed, unknown or other-kind revision', async () => {
    const admin = await signIn(ADMIN);
    const calendar = entry(await index(admin), 'calendar').current!;
    const notFound = [
      await call(admin, 'GET', `${BASE}/lane_mapping/revisions`),
      await call(admin, 'GET', `${BASE}/nope/draft`),
      await call(admin, 'PUT', `${BASE}/nope/draft`, {
        baseRevisionId: null,
        expectedDraftVersion: null,
        body: {},
      }),
      await call(admin, 'DELETE', `${BASE}/nope/draft`, { expectedDraftVersion: 1 }),
      await call(admin, 'POST', `${BASE}/nope/draft/publish`, {
        expectedDraftVersion: 1,
        expectedCurrentRevisionId: null,
      }),
      await call(admin, 'GET', `${BASE}/sla/revisions/not-a-uuid`),
      await call(admin, 'GET', `${BASE}/sla/revisions/${randomUUID()}`),
      await call(admin, 'GET', `${BASE}/sla/revisions/${calendar.revisionId}`),
      await call(admin, 'POST', `${BASE}/sla/revisions/${calendar.revisionId}/restore`, {
        expectedCurrentRevisionId: calendar.revisionId,
        changeNote: 'synthetic',
      }),
    ];
    for (const res of notFound) {
      const error = expectError(res, 404, 'not_found');
      assert.deepEqual(error.details, { resource: 'configuration' });
    }
  });
});

describe('drafts', () => {
  it('saves, replaces and reads a draft with the problems publish would refuse; discards it', async () => {
    const admin = await signIn(ADMIN);
    const base = entry(await index(admin), 'sla').current!.revisionId;
    const first = await saveOk(admin, 'sla', { dpo: 0, ai_coe: 5 }, 'half done');
    assert.equal(first.draftVersion, 1);
    assert.equal(first.baseRevisionId, base);
    assert.equal(first.changeNote, 'half done');
    assert.ok(first.problemCount > 0);
    assert.equal(first.problems.length, first.problemCount);
    for (const p of first.problems) {
      assert.ok(p.path.startsWith('/'), p.path);
      assert.equal(p.messageKey, 'validation.configuration.schema');
    }
    assert.doesNotMatch(JSON.stringify(first.problems), /must be|expected/i); // no prose is served

    const second = await saveOk(admin, 'sla', { dpo: 4, ai_coe: 5, it_security: 5 });
    assert.equal(second.draftVersion, 2);
    assert.equal(second.problemCount, 0);
    assert.deepEqual(second.problems, []);

    const read = await call(admin, 'GET', `${BASE}/sla/draft`);
    assert.equal(read.statusCode, 200, read.body);
    assert.deepEqual(read.json<{ draft: ConfigurationDraftDetail }>().draft.body, {
      dpo: 4,
      ai_coe: 5,
      it_security: 5,
    });
    const summary = entry(await index(admin), 'sla').draft!;
    assert.equal(summary.draftVersion, 2);
    assert.equal(summary.problemCount, 0);
    assert.equal(typeof summary.updatedByDisplayName, 'string');

    const discard = await call(admin, 'DELETE', `${BASE}/sla/draft`, { expectedDraftVersion: 2 });
    assert.equal(discard.statusCode, 204, discard.body);
    assert.equal(discard.body, '');
    const after = await call(admin, 'GET', `${BASE}/sla/draft`);
    assert.deepEqual(after.json(), { draft: null });

    const saved = await auditRows('configuration.draft_saved');
    assert.equal(saved.length, 2);
    assert.equal(saved[0]!.actor_role, 'admin');
    assert.deepEqual(saved[1]!.target_ref, { kind: 'sla', draft_version: 2 });
    const discarded = await auditRows('configuration.draft_discarded');
    assert.equal(discarded.length, 1);
  });

  it('a draft problem on a cross-kind rule carries its W6-03 code as a locale key', async () => {
    const admin = await signIn(ADMIN);
    const draft = await saveOk(admin, 'operator_recipients', { addresses: ['someone@real-company.com'] });
    assert.deepEqual(draft.problems, [
      { path: '/addresses/0', messageKey: 'validation.configuration.recipient_not_synthetic' },
    ]);
    assert.doesNotMatch(capture.text(), /real-company/);
  });

  it('409 configuration_changed on a stale save or discard, with the current state', async () => {
    const admin = await signIn(ADMIN);
    const current = entry(await index(admin), 'calendar').current!.revisionId;
    await saveOk(admin, 'calendar', CONFIGURATION_SEED.calendar);
    const stale = await saveDraft(admin, 'calendar', { holidays: [] }, { expected: null });
    const error = expectError(stale, 409, 'stale_version');
    assert.deepEqual(error.details, {
      reason: 'configuration_changed',
      guidanceKey: 'error.stale_version.guidance.configuration_changed',
      current: { kind: 'calendar', revisionId: current, draftVersion: 1 },
      refreshPath: '/admin/configuration/calendar',
    });
    const staleDiscard = await call(admin, 'DELETE', `${BASE}/calendar/draft`, { expectedDraftVersion: 7 });
    expectError(staleDiscard, 409, 'stale_version');
    const noDraft = await call(admin, 'DELETE', `${BASE}/sla/draft`, { expectedDraftVersion: 1 });
    expectError(noDraft, 409, 'stale_version');
    assert.equal((await auditRows('configuration.draft_saved')).length, 1);
    assert.equal((await auditRows('configuration.draft_discarded')).length, 0);
  });

  it('422 for a body that is not an object, over 64 KiB, a base of another kind, or a blank note', async () => {
    const admin = await signIn(ADMIN);
    const calendar = entry(await index(admin), 'calendar').current!.revisionId;
    const cases: Array<[Json, string, string]> = [
      [{ baseRevisionId: null, expectedDraftVersion: null, body: [1, 2] }, 'body.body', ''],
      [
        {
          baseRevisionId: null,
          expectedDraftVersion: null,
          body: { blob: 'x'.repeat(CONFIGURATION_DRAFT_MAX_BYTES) },
        },
        'body.body',
        'validation.configuration.draft_too_large',
      ],
      [
        { baseRevisionId: calendar, expectedDraftVersion: null, body: {} },
        'body.baseRevisionId',
        'validation.configuration.base_revision_unknown',
      ],
      [
        { baseRevisionId: null, expectedDraftVersion: null, body: {}, changeNote: '   ' },
        'body.changeNote',
        'validation.configuration.change_note_required',
      ],
    ];
    for (const [payload, path, key] of cases) {
      const res = await call(admin, 'PUT', `${BASE}/sla/draft`, payload);
      const error = expectError(res, 422, 'invalid_input');
      const fields = (error.details as { fields: Array<{ path: string; messageKey: string }> }).fields;
      assert.ok(
        fields.some((f) => f.path.startsWith(path) && (key === '' || f.messageKey === key)),
        JSON.stringify(fields),
      );
    }
    assert.equal((await auditRows('configuration.draft_saved')).length, 0);
  });
});

describe('publish and restore', () => {
  it('publishes a draft: 201 summary, draft gone, audit and log line, the next submit freezes it', async () => {
    const admin = await signIn(ADMIN);
    const seedSla = entry(await index(admin), 'sla').current!.revisionId;
    capture.clear();
    const summary = await publishOk(
      admin,
      'sla',
      { dpo: 4, ai_coe: 5, it_security: 5 },
      'synthetic DPO change',
    );
    assert.equal(entry(await index(admin), 'sla').draft, null);
    assert.equal(entry(await index(admin), 'sla').current!.revisionId, summary.revisionId);

    const audit = (await auditRows('configuration.published')).filter(
      (row) => row.target_ref.configuration_revision_id === summary.revisionId,
    );
    assert.equal(audit.length, 1);
    assert.equal(audit[0]!.actor_role, 'admin');
    assert.deepEqual(audit[0]!.before_ref, { configuration_revision_id: seedSla });
    assert.equal(JSON.stringify(audit[0]).includes('synthetic DPO change'), false); // the note is on the revision only

    const lines = events('configuration.published');
    assert.equal(lines.length, 1);
    assert.deepEqual(lines[0]!.fields, { kind: 'sla', revisionId: summary.revisionId, revisionNumber: 2 });
    assert.doesNotMatch(capture.text(), /synthetic DPO change/);
    assertNoLeak(capture);

    advance();
    const owner = await signIn(OWNER);
    await submitOk(owner, await firstDraftCaseId());
    assert.equal(await frozenCountFor('sla', summary.revisionId), 1);
    assert.equal((await revisions(admin, 'sla')).items[0]!.frozenOnVersionCount, 1);
  });

  it('409 configuration_changed on a stale publish; publish_refused stale; nothing written', async () => {
    const admin = await signIn(ADMIN);
    await saveOk(admin, 'sla', { dpo: 4, ai_coe: 5, it_security: 5 }, 'note');
    capture.clear();
    const stale = await call(admin, 'POST', `${BASE}/sla/draft/publish`, {
      expectedDraftVersion: 2,
      expectedCurrentRevisionId: entry(await index(admin), 'sla').current!.revisionId,
    });
    expectError(stale, 409, 'stale_version');
    const wrongCurrent = await call(admin, 'POST', `${BASE}/sla/draft/publish`, {
      expectedDraftVersion: 1,
      expectedCurrentRevisionId: null,
    });
    expectError(wrongCurrent, 409, 'stale_version');
    assert.deepEqual(
      events('configuration.publish_refused').map((l) => l.fields),
      [
        { kind: 'sla', reason: 'stale', problemCount: 0 },
        { kind: 'sla', reason: 'stale', problemCount: 0 },
      ],
    );
    assert.equal((await revisions(admin, 'sla')).total, 1);
    assert.equal(entry(await index(admin), 'sla').draft!.draftVersion, 1);
  });

  it('422 with every problem as a FieldError; the draft is kept; publish_refused invalid', async () => {
    const admin = await signIn(ADMIN);
    const rules = structuredClone(CONFIGURATION_SEED.qc_rules) as unknown as {
      templates: Record<string, { rules: Array<Json> }>;
    };
    const v2 = rules.templates['v2.0']!;
    v2.rules = [
      ...v2.rules,
      { ruleId: 'SYNTH-NOT-A-RULE', engine: 'metadata', severity: 'low', triggers: ['submit'] },
    ];
    delete rules.templates['v1.0 Sheet3'];
    await saveOk(admin, 'qc_rules', rules);
    capture.clear();
    const res = await publish(admin, 'qc_rules', 'synthetic catalogue');
    const error = expectError(res, 422, 'invalid_input');
    const fields = (error.details as { fields: Array<{ path: string; messageKey: string }> }).fields;
    const keys = fields.map((f) => f.messageKey);
    assert.ok(keys.includes('validation.configuration.rule_not_implemented'), JSON.stringify(fields));
    assert.ok(keys.includes('validation.configuration.catalogue_missing_template'), JSON.stringify(fields));
    for (const f of fields) assert.ok(isLocaleKey(f.messageKey), f.messageKey);
    assert.ok(fields.some((f) => f.path === `/templates/v2.0/rules/${v2.rules.length - 1}`));
    const refused = events('configuration.publish_refused');
    assert.deepEqual(
      refused.map((l) => l.fields),
      [{ kind: 'qc_rules', reason: 'invalid', problemCount: fields.length }],
    );
    assert.equal(entry(await index(admin), 'qc_rules').draft!.draftVersion, 1);
    assert.equal((await revisions(admin, 'qc_rules')).total, 1);

    // A publish without any change note (neither the draft's nor the request's) is refused too.
    await call(admin, 'DELETE', `${BASE}/qc_rules/draft`, { expectedDraftVersion: 1 });
    await saveOk(admin, 'sla', { dpo: 4, ai_coe: 5, it_security: 5 });
    const noNote = await publish(admin, 'sla');
    const e2 = expectError(noNote, 422, 'invalid_input');
    assert.deepEqual((e2.details as { fields: unknown[] }).fields, [
      { path: 'body.changeNote', messageKey: 'validation.configuration.change_note_required' },
    ]);
  });

  it('restores an older revision as N+1; refuses the current one; stale and 422 paths', async () => {
    const admin = await signIn(ADMIN);
    const seed = entry(await index(admin), 'sla').current!;
    const r2 = await publishOk(admin, 'sla', { dpo: 4, ai_coe: 5, it_security: 5 });

    const current = await call(admin, 'POST', `${BASE}/sla/revisions/${r2.revisionId}/restore`, {
      expectedCurrentRevisionId: r2.revisionId,
      changeNote: 'synthetic',
    });
    const e = expectError(current, 422, 'invalid_input');
    assert.deepEqual((e.details as { fields: unknown[] }).fields, [
      { path: 'params.revisionId', messageKey: 'error.invalid_input.restore_current' },
    ]);
    const stale = await call(admin, 'POST', `${BASE}/sla/revisions/${seed.revisionId}/restore`, {
      expectedCurrentRevisionId: seed.revisionId,
      changeNote: 'synthetic',
    });
    const staleError = expectError(stale, 409, 'stale_version');
    assert.equal(
      (staleError.details as { current: { revisionId: string } }).current.revisionId,
      r2.revisionId,
    );
    const blank = await call(admin, 'POST', `${BASE}/sla/revisions/${seed.revisionId}/restore`, {
      expectedCurrentRevisionId: r2.revisionId,
      changeNote: ' ',
    });
    expectError(blank, 422, 'invalid_input');

    capture.clear();
    const res = await call(admin, 'POST', `${BASE}/sla/revisions/${seed.revisionId}/restore`, {
      expectedCurrentRevisionId: r2.revisionId,
      changeNote: 'back to the seed (synthetic)',
    });
    assert.equal(res.statusCode, 201, res.body);
    const restored = res.json<ConfigurationRevisionSummary>();
    assert.ok(Value.Check(ConfigurationRevisionSummarySchema, restored));
    assert.equal(restored.revisionNumber, 3);
    assert.equal(restored.restoresRevisionNumber, 1);
    assert.equal(restored.changeNote, 'back to the seed (synthetic)');
    const detail = await call(admin, 'GET', `${BASE}/sla/revisions/${restored.revisionId}`);
    assert.deepEqual(detail.json<ConfigurationRevisionDetail>().body, CONFIGURATION_SEED.sla);
    assert.deepEqual(
      events('configuration.published').map((l) => l.fields),
      [
        {
          kind: 'sla',
          revisionId: restored.revisionId,
          revisionNumber: 3,
          restoresRevisionId: seed.revisionId,
        },
      ],
    );
    const audit = (await auditRows('configuration.published')).find(
      (row) => row.target_ref.configuration_revision_id === restored.revisionId,
    )!;
    assert.deepEqual(audit.after_ref, {
      configuration_revision_id: restored.revisionId,
      restores_configuration_revision_id: seed.revisionId,
    });
  });

  it("a restore whose body fails today's cross-kind checks is 422 with its problems", async () => {
    const admin = await signIn(ADMIN);
    const seedRules = entry(await index(admin), 'qc_rules').current!;
    // Add a synthetic template the documented way: catalogue entry first, then the template list.
    const rules = structuredClone(CONFIGURATION_SEED.qc_rules) as unknown as {
      label: string;
      templates: Record<string, { rules: Array<Json> }>;
    };
    rules.label = 'w6-04.synthetic';
    rules.templates['v3.0-synthetic'] = structuredClone(rules.templates['v2.0']!);
    const r2 = await publishOk(admin, 'qc_rules', rules);
    await publishOk(admin, 'checklist_templates', {
      versions: [...CONFIGURATION_SEED.checklist_templates.versions, 'v3.0-synthetic'],
    });
    capture.clear();
    const res = await call(admin, 'POST', `${BASE}/qc_rules/revisions/${seedRules.revisionId}/restore`, {
      expectedCurrentRevisionId: r2.revisionId,
      changeNote: 'synthetic restore',
    });
    const error = expectError(res, 422, 'invalid_input');
    assert.deepEqual((error.details as { fields: unknown[] }).fields, [
      { path: '/templates', messageKey: 'validation.configuration.catalogue_missing_template' },
    ]);
    assert.deepEqual(
      events('configuration.publish_refused').map((l) => l.fields),
      [{ kind: 'qc_rules', reason: 'invalid', problemCount: 1 }],
    );
    assert.equal((await revisions(admin, 'qc_rules')).total, 2);
  });
});

describe('T40: Admin only', () => {
  const nonAdmins = FIXTURE_USERS.filter((u) => !u.roles.some((r) => r.role === 'admin')).map(
    (u) => u.fixtureUserId,
  );

  it('every non-Admin role is 403 on every route (also for an unknown kind); no session is 401', async () => {
    assert.ok(nonAdmins.length >= 6);
    const admin = await signIn(ADMIN);
    const sla = entry(await index(admin), 'sla').current!.revisionId;
    const routes: Array<[method: 'GET' | 'PUT' | 'POST' | 'DELETE', url: string, payload?: Json]> = [
      ['GET', BASE],
      ['GET', `${BASE}/sla/revisions`],
      ['GET', `${BASE}/sla/revisions/${sla}`],
      ['GET', `${BASE}/sla/draft`],
      ['PUT', `${BASE}/sla/draft`, { baseRevisionId: sla, expectedDraftVersion: null, body: { dpo: 1 } }],
      ['DELETE', `${BASE}/sla/draft`, { expectedDraftVersion: 1 }],
      ['POST', `${BASE}/sla/draft/publish`, { expectedDraftVersion: 1, expectedCurrentRevisionId: sla }],
      ['POST', `${BASE}/sla/revisions/${sla}/restore`, { expectedCurrentRevisionId: sla, changeNote: 'x' }],
      ['GET', `${BASE}/not_a_kind/revisions`],
    ];
    capture.clear();
    for (const id of nonAdmins) {
      const session = await signIn(id);
      for (const [method, url, payload] of routes) {
        const res = await call(session, method, url, payload);
        expectError(res, 403, 'forbidden');
      }
    }
    for (const [method, url, payload] of routes) {
      const res = await call(null, method, url, payload);
      expectError(res, 401, 'unauthenticated');
    }
    const denied = events('authz.denied');
    assert.equal(denied.length, nonAdmins.length * routes.length);
    assert.ok(denied.every((l) => l.fields?.reason === 'role'));
    assert.equal((await auditRows('configuration.draft_saved')).length, 0);
    assert.equal((await revisions(admin, 'sla')).total, 1);
  });
});

/** A fixture case whose open draft is complete enough to submit (the W6-13 suite submits it too). */
async function firstDraftCaseId(): Promise<string> {
  return Promise.resolve(findFixtureCase('fx-case-vendor')!.caseId);
}

async function frozenCountFor(kind: string, revisionId: string): Promise<number> {
  const r = await db.owner.execute(
    sql`SELECT count(*)::int AS n FROM pack_version WHERE frozen_configuration ->> ${kind} = ${revisionId}`,
  );
  return (r.rows[0] as { n: number }).n;
}
