// W5-02 (W5 plan sections 3 and 6): GET /api/configuration/risk-rubric/current returns the `risk_rubric` revision in
// force now (the seeded SYNTHETIC PLACEHOLDER `synthetic-placeholder.1`, never the D07 instrument), for every role
// (`config.read_effective`); 404 `not_found` (`risk_rubric`) when none is in force; 401 without a session. Fixture
// app on the real Postgres; fixture set slice1-synthetic@1; synthetic data only.

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { ErrorResponse } from '@rai/shared/errors';
import type { RiskRubricView } from '@rai/shared/schemas/cases';
import { CONFIGURATION_SEED, SEED_KINDS } from '@rai/server/configuration/seed';
import { publishRevision } from '@rai/server/configuration/store';
import { withTransaction } from '@rai/server/db/transaction';
import { app, db, openFixtureApp, signIn } from '../support/fixture-app.js';
import { asUser, type FixtureSession } from '../support/sign-in.js';

const URL_PATH = '/api/configuration/risk-rubric/current';
const START = Date.parse('2026-09-27T06:00:00Z');
let clock = START;
const now = () => new Date(clock);

beforeEach(() => {
  clock = START;
});
openFixtureApp({ now });

const EVERY_ROLE_USER = [
  'fx-user-owner-cm',
  'fx-user-spoc-cm',
  'fx-user-ai-coe',
  'fx-user-dpo',
  'fx-user-it-security',
  'fx-user-admin',
];

function read(session: FixtureSession | null) {
  return app.inject({ method: 'GET', url: URL_PATH, headers: session === null ? {} : asUser(session) });
}

async function riskRubricRows(): Promise<Array<{ id: string; published_at: Date; revision_number: number }>> {
  const result = await db.owner.execute(
    sql`SELECT id, published_at, revision_number FROM configuration_revision WHERE kind = 'risk_rubric' ORDER BY revision_number`,
  );
  return result.rows as Array<{ id: string; published_at: Date; revision_number: number }>;
}

describe('W5-02 GET /api/configuration/risk-rubric/current', () => {
  it('200: every role reads the seeded synthetic placeholder in force now', async () => {
    const [seeded] = await riskRubricRows();
    assert.ok(seeded);
    for (const user of EVERY_ROLE_USER) {
      const res = await read(await signIn(user));
      assert.equal(res.statusCode, 200, `${user}: ${res.body}`);
      const view = res.json<RiskRubricView>();
      assert.deepEqual(view, {
        revisionId: seeded.id,
        label: 'synthetic-placeholder.1',
        provenance: 'synthetic_placeholder',
        publishedAt: new Date(seeded.published_at).toISOString(),
        body: CONFIGURATION_SEED.risk_rubric,
      });
    }
  });

  it('401 without a session; nothing about the rubric leaks', async () => {
    const res = await read(null);
    assert.equal(res.statusCode, 401);
    assert.doesNotMatch(res.body, /PLACEHOLDER|RQ1/);
  });

  it('404 not_found (risk_rubric) when no revision is in force; the other kinds are unaffected', async () => {
    // A database configured before W5-02: every kind but risk_rubric.
    await db.owner.execute(sql.raw('TRUNCATE TABLE "configuration_revision" CASCADE'));
    await withTransaction(db.app, async (tx) => {
      for (const kind of SEED_KINDS.filter((k) => k !== 'risk_rubric'))
        await publishRevision(tx, {
          kind,
          body: CONFIGURATION_SEED[kind],
          publishedBy: 'system',
          publishedRole: 'system',
          correlationId: randomUUID(),
          publishedAt: new Date(START - 60_000),
        });
    });
    const owner = await signIn('fx-user-owner-cm');
    const res = await read(owner);
    assert.equal(res.statusCode, 404, res.body);
    const body = res.json<ErrorResponse<'not_found'>>();
    assert.equal(body.error.code, 'not_found');
    assert.deepEqual(body.error.details, { resource: 'risk_rubric' });
    const config = await app.inject({
      method: 'GET',
      url: '/api/configuration/current',
      headers: asUser(owner),
    });
    assert.equal(config.statusCode, 200, config.body);
  });

  it('a later revision applies only after its publish instant (W1-00 activation rule)', async () => {
    const [first] = await riskRubricRows();
    assert.ok(first);
    const publishedAt = new Date(START + 60_000);
    const second = await withTransaction(db.app, (tx) =>
      publishRevision(tx, {
        kind: 'risk_rubric',
        body: { ...CONFIGURATION_SEED.risk_rubric, label: 'synthetic-placeholder.2' },
        publishedBy: 'fixture:fx-user-admin',
        publishedRole: 'admin',
        correlationId: randomUUID(),
        publishedAt,
      }),
    );
    const admin = await signIn('fx-user-admin');
    clock = publishedAt.getTime();
    const atInstant = await read(admin);
    assert.equal(atInstant.json<RiskRubricView>().revisionId, first.id, 'not at the exact instant');
    clock = publishedAt.getTime() + 1;
    const after = await read(admin);
    assert.equal(after.statusCode, 200);
    assert.equal(after.json<RiskRubricView>().revisionId, second.id);
    assert.equal(after.json<RiskRubricView>().label, 'synthetic-placeholder.2');
  });
});
