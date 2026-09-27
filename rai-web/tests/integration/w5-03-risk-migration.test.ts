// W5-03 (W5 plan section 5): the risk migration's guards on a real Postgres with the fixture set loaded.
// - pack_version.risk_answers is editable on a draft and frozen with the row at submit (rai_pack_version_frozen
//   compares the whole row, so the new column needs no trigger change);
// - risk_proposal is append-only (no UPDATE, no DELETE for any role; rai_app has no DELETE grant at all);
// - case.risk_tier accepts 'unknown', still only inside rai.workflow_write (the W1-00 projection gate);
// - at most one submit proposal per version (partial unique index), and the status consistency CHECK.
// Synthetic fixture data only (fixture set slice1-synthetic@1); no rubric content (D07 stays open).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import { INSUFFICIENT_PRIVILEGE, RAISE_EXCEPTION, expectSqlError } from '../support/db.js';
import { db, openFixtureApp, signIn, submitOk } from '../support/fixture-app.js';

const SET = fixtureSetLabel(readManifest());
const OWNER_A = 'fx-user-owner-cm';
const VENDOR = findFixtureCase('fx-case-vendor')!;

const START = Date.parse('2026-09-27T05:00:00Z');
let clock = START;
const now = () => new Date((clock += 1000));

openFixtureApp({ now });

const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

async function submitVendor() {
  const owner = await signIn(OWNER_A);
  const version = await submitOk(owner, VENDOR.caseId);
  const row = await db.owner.execute(
    sql`SELECT configuration_revision_id FROM pack_version WHERE id = ${version.versionId}`,
  );
  const revisionId = (row.rows[0] as { configuration_revision_id: string }).configuration_revision_id;
  return { versionId: version.versionId, revisionId };
}

async function openDraftId(): Promise<{ id: string; caseId: string }> {
  const rows = await db.owner.execute(
    sql`SELECT id, case_id FROM pack_version WHERE submitted_at IS NULL ORDER BY id LIMIT 1`,
  );
  assert.ok(rows.rows.length > 0, 'the fixture set holds an open draft');
  const row = rows.rows[0] as { id: string; case_id: string };
  return { id: row.id, caseId: row.case_id };
}

interface ProposalRow {
  id?: string;
  versionId: string;
  trigger?: string;
  status?: string;
  unavailableReason?: string | null;
  tier?: string | null;
  lowestTier?: string | null;
  highestTier?: string | null;
  rubricRevisionId?: string | null;
}

const INSERT_PROPOSAL = `INSERT INTO risk_proposal
  (id, case_id, version_id, trigger, status, unavailable_reason, tier, lowest_tier, highest_tier,
   rubric_revision_id, rubric_label, engine_version, inputs_hash, explanation, correlation_id, created_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'risk-engine/1', $12, $13::jsonb, $14, now())`;

function proposalParams(row: ProposalRow): unknown[] {
  const status = row.status ?? 'proposed';
  return [
    row.id ?? randomUUID(),
    VENDOR.caseId,
    row.versionId,
    row.trigger ?? 'submit',
    status,
    row.unavailableReason ?? null,
    row.tier === undefined ? (status === 'proposed' ? 'unknown' : null) : row.tier,
    row.lowestTier === undefined ? (status === 'proposed' ? 'low' : null) : row.lowestTier,
    row.highestTier === undefined ? (status === 'proposed' ? 'high' : null) : row.highestTier,
    row.rubricRevisionId ?? null,
    status === 'proposed' ? 'synthetic-placeholder.1' : null,
    status === 'proposed' ? 'a'.repeat(64) : null,
    status === 'proposed' ? JSON.stringify({ questions: [] }) : null,
    `w5-03-${randomUUID()}`,
  ];
}

async function insertProposal(role: 'app' | 'owner', row: ProposalRow) {
  return expectSqlError(db, role, INSERT_PROPOSAL, proposalParams(row));
}

describe(`W5-03 risk migration guards — ${SET}`, () => {
  it('a draft carries risk_answers {} by default and may change it; a submitted version raises rai.frozen_version as rai_app and rai_owner', async () => {
    const draft = await openDraftId();
    const before = await db.owner.execute(sql`SELECT risk_answers FROM pack_version WHERE id = ${draft.id}`);
    assert.deepEqual((before.rows[0] as { risk_answers: unknown }).risk_answers, {});
    const onDraft = await expectSqlError(
      db,
      'app',
      `UPDATE pack_version SET risk_answers = $1::jsonb WHERE id = $2`,
      [JSON.stringify({ RQ1: { value: 'unknown' } }), draft.id],
    );
    assert.equal(onDraft, undefined, onDraft?.message);

    const { versionId } = await submitVendor();
    const frozen = await db.owner.execute(sql`SELECT risk_answers FROM pack_version WHERE id = ${versionId}`);
    const frozenValue = (frozen.rows[0] as { risk_answers: unknown }).risk_answers;
    for (const role of ['app', 'owner'] as const) {
      const err = await expectSqlError(
        db,
        role,
        `UPDATE pack_version SET risk_answers = $1::jsonb WHERE id = $2`,
        [JSON.stringify({ RQ1: { value: 'low' } }), versionId],
      );
      assert.equal(err?.code, RAISE_EXCEPTION, `${role}: ${err?.message}`);
      assert.equal(err?.message, 'rai.frozen_version');
    }
    const after = await db.owner.execute(sql`SELECT risk_answers FROM pack_version WHERE id = ${versionId}`);
    assert.deepEqual((after.rows[0] as { risk_answers: unknown }).risk_answers, frozenValue);
  });

  it('risk_proposal is append-only: rai_app and rai_operator have no UPDATE or DELETE grant; rai_owner is refused by the trigger with rai.append_only', async () => {
    const { versionId, revisionId } = await submitVendor();
    const id = randomUUID();
    const inserted = await insertProposal('app', { id, versionId, rubricRevisionId: revisionId });
    assert.equal(inserted, undefined, inserted?.message);

    for (const statement of [
      `UPDATE risk_proposal SET tier = 'low' WHERE id = $1`,
      `DELETE FROM risk_proposal WHERE id = $1`,
    ]) {
      // rai_app (and rai_operator, a member of it) holds SELECT and INSERT only.
      for (const role of ['app', 'operator'] as const) {
        const err = await expectSqlError(db, role, statement, [id]);
        assert.equal(err?.code, INSUFFICIENT_PRIVILEGE, `${role}: ${statement}: ${err?.message}`);
      }
      // rai_owner has every privilege; the trigger refuses it.
      const owner = await expectSqlError(db, 'owner', statement, [id]);
      assert.equal(owner?.code, RAISE_EXCEPTION, `owner: ${statement}: ${owner?.message}`);
      assert.equal(owner?.message, 'rai.append_only');
    }

    const row = await db.owner.execute(sql`SELECT tier, status FROM risk_proposal WHERE id = ${id}`);
    assert.deepEqual(row.rows, [{ tier: 'unknown', status: 'proposed' }]);
  });

  it("case.risk_tier = 'unknown' outside rai.workflow_write raises rai.projection_write_forbidden; inside it is written; an undeclared tier fails the CHECK", async () => {
    const outside = await expectSqlError(db, 'app', `UPDATE "case" SET risk_tier = 'unknown' WHERE id = $1`, [
      VENDOR.caseId,
    ]);
    assert.equal(outside?.code, RAISE_EXCEPTION, outside?.message);
    assert.equal(outside?.message, 'rai.projection_write_forbidden');

    const inside = await db.raw('app', async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(`SET LOCAL rai.workflow_write = 'on'`);
        await client.query(`UPDATE "case" SET risk_tier = 'unknown' WHERE id = $1`, [VENDOR.caseId]);
        await client.query('COMMIT');
        return undefined;
      } catch (err) {
        await client.query('ROLLBACK');
        return err as Error;
      }
    });
    assert.equal(inside, undefined, inside?.message);
    const tier = await db.owner.execute(sql`SELECT risk_tier FROM "case" WHERE id = ${VENDOR.caseId}`);
    assert.equal((tier.rows[0] as { risk_tier: string }).risk_tier, 'unknown');

    const undeclared = await db.raw('owner', async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(`SET LOCAL rai.workflow_write = 'on'`);
        await client.query(`UPDATE "case" SET risk_tier = 'critical' WHERE id = $1`, [VENDOR.caseId]);
        await client.query('COMMIT');
        return undefined;
      } catch (err) {
        await client.query('ROLLBACK');
        return err as Error & { code?: string; constraint?: string };
      }
    });
    assert.equal(undeclared?.code, CHECK_VIOLATION, undeclared?.message);
    assert.equal(undeclared?.constraint, 'case_risk_tier_check');
  });

  it('a second submit proposal on one version violates risk_proposal_one_submit_per_version_key; a recheck proposal on it is accepted', async () => {
    const { versionId, revisionId } = await submitVendor();
    assert.equal(await insertProposal('app', { versionId, rubricRevisionId: revisionId }), undefined);
    const second = (await insertProposal('app', {
      versionId,
      status: 'unavailable',
      unavailableReason: 'engine_error',
    })) as (Error & { code?: string; constraint?: string }) | undefined;
    assert.equal(second?.code, UNIQUE_VIOLATION, second?.message);
    assert.equal(second?.constraint, 'risk_proposal_one_submit_per_version_key');
    const recheck = await insertProposal('app', {
      versionId,
      trigger: 'recheck',
      rubricRevisionId: revisionId,
    });
    assert.equal(recheck, undefined, recheck?.message);
  });

  it('the status consistency CHECK: proposed needs a tier and a rubric revision and no reason; unavailable needs a reason and no tier; not_configured may omit the rubric revision', async () => {
    const { versionId, revisionId } = await submitVendor();
    const refused: ProposalRow[] = [
      { versionId, trigger: 'recheck', tier: null, rubricRevisionId: revisionId },
      { versionId, trigger: 'recheck', rubricRevisionId: null },
      { versionId, trigger: 'recheck', rubricRevisionId: revisionId, unavailableReason: 'engine_error' },
      { versionId, trigger: 'recheck', status: 'unavailable', unavailableReason: null },
      {
        versionId,
        trigger: 'recheck',
        status: 'unavailable',
        unavailableReason: 'engine_error',
        tier: 'low',
      },
    ];
    for (const row of refused) {
      const err = (await insertProposal('owner', row)) as
        (Error & { code?: string; constraint?: string }) | undefined;
      assert.equal(err?.code, CHECK_VIOLATION, `${JSON.stringify(row)}: ${err?.message}`);
      assert.equal(err?.constraint, 'risk_proposal_status_consistency_check');
    }
    const badEnum = (await insertProposal('owner', {
      versionId,
      trigger: 'upload',
      rubricRevisionId: revisionId,
    })) as (Error & { code?: string }) | undefined;
    assert.equal(badEnum?.code, CHECK_VIOLATION, badEnum?.message);
    const notConfigured = await insertProposal('app', {
      versionId,
      status: 'unavailable',
      unavailableReason: 'not_configured',
    });
    assert.equal(notConfigured, undefined, notConfigured?.message);
  });
});
