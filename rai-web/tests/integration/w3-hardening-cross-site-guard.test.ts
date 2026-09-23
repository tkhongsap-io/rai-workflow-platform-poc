// The CSRF guard in the authorization middleware (W0-03 sections 6.1 and 6.4): SameSite=Lax still sends the session
// cookie on same-site requests (another port on loopback, a sibling subdomain), so a signed-in state-changing
// request that a browser marks `Sec-Fetch-Site: cross-site` or `same-site` is 403 before its body is read. The
// same request marked `same-origin`, or with no header (a non-browser client, which carries no ambient cookie),
// goes through. Rows: an owner's multipart upload and a locale POST.

import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import type { SessionInfo } from '@rai/shared/schemas/auth';
import { auditStore } from '@rai/server/audit/store';
import { FIXTURE_CASES } from '@rai/fixtures/data/cases/index';
import {
  fileUpload,
  fixtureBaseDocuments,
  objectCount,
  openHarness,
  signIn,
  type Harness,
} from './w1-03-helpers.js';

const CASE_CM = FIXTURE_CASES.find((c) => c.fixtureCaseId === 'fx-case-nonvendor')!;
const pdf = fixtureBaseDocuments().pdf;

let h: Harness;
before(async () => {
  h = await openHarness();
});
beforeEach(async () => {
  await h.reload();
});
after(async () => {
  await h.close();
});

const siteHeader = (site: string | undefined) => (site === undefined ? {} : { 'sec-fetch-site': site });

function uploadAs(cookie: string, site: string | undefined) {
  const body = fileUpload('a.pdf', pdf, 'application/pdf');
  return h.app.inject({
    method: 'POST',
    url: `/api/cases/${CASE_CM.caseId}/artifacts`,
    headers: { ...body.headers, cookie, ...siteHeader(site) },
    payload: body.payload,
  });
}

function setLocale(cookie: string, site: string | undefined) {
  return h.app.inject({
    method: 'POST',
    url: '/api/session/locale',
    headers: { cookie, ...siteHeader(site) },
    payload: { locale: 'en' },
  });
}

async function localeOf(cookie: string): Promise<string> {
  const res = await h.app.inject({ method: 'GET', url: '/api/session', headers: { cookie } });
  return res.json<SessionInfo>().locale;
}

async function counts() {
  const artifacts = await h.db.owner.execute(sql`SELECT count(*)::int AS n FROM artifact`);
  return {
    artifacts: (artifacts.rows[0] as { n: number }).n,
    objects: await objectCount(h.blobDir),
    audit: (await auditStore.read(h.db.app, {})).length,
  };
}

for (const site of ['cross-site', 'same-site']) {
  test(`Sec-Fetch-Site ${site}: an owner's upload and a locale POST are 403 forbidden; no artifact row, blob or audit row; one authz.denied cross_site line each`, async () => {
    const owner = await signIn(h.app, 'fx-user-owner-cm');
    const before = await counts();

    const up = await uploadAs(owner.cookie, site);
    const locale = await setLocale(owner.cookie, site);
    for (const res of [up, locale]) {
      assert.equal(res.statusCode, 403, res.body);
      const error = res.json<{ error: Record<string, unknown> }>().error;
      assert.deepEqual(Object.keys(error).sort(), ['code', 'correlationId', 'messageKey']);
      assert.equal(error.code, 'forbidden');
    }

    assert.deepEqual(await counts(), before, 'nothing written');
    assert.deepEqual(await readdir(h.store.tmpDir), [], 'the multipart body was never streamed to disk');
    assert.equal(await localeOf(owner.cookie), 'th', 'the locale is unchanged');

    const denied = h.linesFor('authz.denied');
    assert.deepEqual(
      denied.map((l) => l.correlationId),
      [up.headers['x-correlation-id'], locale.headers['x-correlation-id']],
    );
    assert.deepEqual(denied[0]!.fields, {
      action: 'artifact.upload',
      targetType: 'case',
      actorSubjectId: 'fixture:fx-user-owner-cm',
      actorRole: 'owner',
      reason: 'cross_site',
    });
    assert.deepEqual(denied[1]!.fields, {
      actorSubjectId: 'fixture:fx-user-owner-cm',
      actorRole: 'owner',
      reason: 'cross_site',
    });

    const read = await h.app.inject({
      method: 'GET',
      url: '/api/session',
      headers: { cookie: owner.cookie, 'sec-fetch-site': site },
    });
    assert.equal(read.statusCode, 200, 'a read is not guarded');
  });
}

for (const site of ['same-origin', undefined]) {
  test(`Sec-Fetch-Site ${site ?? 'absent'}: the same upload and locale POST succeed`, async () => {
    const owner = await signIn(h.app, 'fx-user-owner-cm');
    const up = await uploadAs(owner.cookie, site);
    assert.equal(up.statusCode, 201, up.body);
    const locale = await setLocale(owner.cookie, site);
    assert.equal(locale.statusCode, 204, locale.body);
    assert.equal(await localeOf(owner.cookie), 'en');
    assert.equal(h.linesFor('authz.denied').length, 0);
  });
}

test('without a session a cross-site write is 401 before the guard: no authz.denied line', async () => {
  const res = await setLocale('rai_session=forged', 'cross-site');
  assert.equal(res.statusCode, 401);
  assert.equal(h.linesFor('authz.denied').length, 0);
});
