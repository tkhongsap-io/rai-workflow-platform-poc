// W3-F2 (#164), register row "W3 deferred rulings" item 10: a lane reviewer who is BU SPOC on the case gets no
// lane-opened mail for that lane (W0-05 3.3); on a case of another BU the same reviewer still gets it (W0-05 T20).
// Uses the composed app, so the recipients are the production wiring's. Fixture set slice1-synthetic@1.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { findFixtureUser } from '@rai/fixtures/data/users';
import { findFixtureCase } from '@rai/fixtures/data/cases/index';
import { fixtureSetLabel, readManifest } from '@rai/fixtures/manifest';
import { db, openFixtureApp, signIn, submit } from '../support/fixture-app.js';

const SET = fixtureSetLabel(readManifest());
const DUAL = findFixtureUser('fx-user-dpo-spoc-hr')!; // DPO reviewer and BU SPOC of HR
const DPO = findFixtureUser('fx-user-dpo')!;
const HR_CASE = findFixtureCase('fx-case-hr-dualrole')!; // BU HR, owned by the CM owner
const CM_CASE = findFixtureCase('fx-case-nonvendor')!; // BU CM

openFixtureApp({ now: () => new Date(Date.parse('2026-09-26T06:01:00Z')) });

async function dpoLaneOpenRecipients(versionId: string): Promise<string[]> {
  const rows = await db.owner.execute(
    sql`SELECT recipient FROM notification WHERE event = 'lane_open' AND lane = 'dpo' AND version_id = ${versionId} ORDER BY recipient`,
  );
  return (rows.rows as Array<{ recipient: string }>).map((r) => r.recipient);
}

describe(`W3-F2 lane-opened mail skips a BU-SPOC reviewer — ${SET}`, () => {
  it('HR case: the DPO lane-opened mail goes to the DPO reviewer only, not to the HR SPOC who is also a DPO reviewer', async () => {
    const owner = await signIn('fx-user-owner-cm');
    const { version } = await submit(owner, HR_CASE.caseId);
    assert.deepEqual(await dpoLaneOpenRecipients(version.versionId), [DPO.email]);
  });

  it('CM case: the same dual-role reviewer may decide the DPO lane, so still gets its lane-opened mail', async () => {
    const owner = await signIn('fx-user-owner-cm');
    const { version } = await submit(owner, CM_CASE.caseId);
    assert.deepEqual(await dpoLaneOpenRecipients(version.versionId), [DUAL.email, DPO.email].sort());
  });
});
