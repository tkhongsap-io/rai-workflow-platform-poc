import test from 'node:test';
import assert from 'node:assert/strict';
import type { QueueResponse } from '@rai/shared/schemas/queue';
import { createApiSubstitute } from './handler.js';
import { call, signIn } from './testing.js';

test('queue rejects anonymous requests and scopes items, options and counts before filtering', async () => {
  const api = createApiSubstitute();
  assert.equal((await call(api, 'GET', '/api/queue')).status, 401);
  const cookie = await signIn(api, 'fx-user-owner-cm-2');
  const empty = (await call(api, 'GET', '/api/queue', { cookie })).json<QueueResponse>();
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.filterOptions, { statuses: [], owners: [], useCaseGroups: [] });
  assert.equal(
    Object.values(empty.statusCounts).reduce((a, b) => a + b, 0),
    0,
  );
  const filtered = (
    await call(api, 'GET', '/api/queue?owner=fixture%3Afx-user-owner-cm', { cookie })
  ).json<QueueResponse>();
  assert.deepEqual(filtered, empty);
});

test('queue validates query and paginates stable scoped cards with literal and Thai search', async () => {
  const api = createApiSubstitute();
  const cookie = await signIn(api, 'fx-user-admin');
  const all = (await call(api, 'GET', '/api/queue', { cookie })).json<QueueResponse>();
  assert.equal(all.total, 5);
  const page = (await call(api, 'GET', '/api/queue?page=2&pageSize=2', { cookie })).json<QueueResponse>();
  assert.deepEqual(page.items, all.items.slice(2, 4));
  assert.deepEqual(page.statusCounts, all.statusCounts);
  assert.ok(
    all.items.every(
      (item) =>
        item.latestVersionNumber === 1 && item.lanes.length === 0 && item.nextAction === 'prepare_pack',
    ),
  );
  for (const query of [
    'page=0',
    'pageSize=101',
    'includeAll=true',
    '__proto__=x',
    'status=ready',
    'searchBy=email',
  ])
    assert.equal((await call(api, 'GET', `/api/queue?${query}`, { cookie })).status, 422);
  const literal = (await call(api, 'GET', '/api/queue?search=%25', { cookie })).json<QueueResponse>();
  assert.equal(literal.total, 0);
  const stored = [...api.store.cases.values()][0]!;
  stored.fields.useCaseName = 'ทดสอบการค้นหา';
  const thai = (
    await call(api, 'GET', '/api/queue?search=' + encodeURIComponent('ค้นหา'), { cookie })
  ).json<QueueResponse>();
  assert.deepEqual(
    thai.items.map((item) => item.caseId),
    [stored.caseId],
  );
  const ownerName = all.items[0]!.ownerDisplayName;
  const owner = (
    await call(api, 'GET', '/api/queue?searchBy=owner&search=' + encodeURIComponent(ownerName), { cookie })
  ).json<QueueResponse>();
  assert.ok(owner.total > 0);
  assert.ok(owner.items.every((item) => item.ownerDisplayName.includes(ownerName)));
});

test('submitted queue returns three lane due dates and the submitted version', async () => {
  const api = createApiSubstitute({ now: () => new Date('2026-04-09T02:00:00Z') });
  const cookie = await signIn(api, 'fx-user-owner-cm');
  const stored = [...api.store.cases.values()].find((c) => c.fixtureCaseId === 'fx-case-nonvendor')!;
  const submitted = await call(api, 'POST', `/api/cases/${stored.caseId}/draft/submit`, {
    cookie,
    headers: { 'idempotency-key': 'queue-submit-1' },
    json: { expectedVersion: { versionId: stored.draft!.draftId, revision: 1 } },
  });
  assert.equal(submitted.status, 201, submitted.text());
  const queue = (await call(api, 'GET', '/api/queue?status=in_review', { cookie })).json<QueueResponse>();
  const card = queue.items.find((item) => item.caseId === stored.caseId)!;
  const oldDays = api.store.configuration.slaWorkingDays.dpo;
  try {
    api.store.configuration.slaWorkingDays.dpo = 15;
    const again = (await call(api, 'GET', '/api/queue?status=in_review', { cookie })).json<QueueResponse>();
    assert.deepEqual(again.items.find((item) => item.caseId === stored.caseId)!.lanes, card.lanes);
  } finally {
    api.store.configuration.slaWorkingDays.dpo = oldDays;
  }
  assert.equal(card.latestVersionNumber, 1);
  assert.equal(card.nextAction, 'review_lanes');
  assert.deepEqual(
    card.lanes.map((lane) => [lane.lane, lane.status, lane.due.dueOn]),
    [
      ['ai_coe', 'pending', '2026-04-21'],
      ['dpo', 'pending', '2026-04-17'],
      ['it_security', 'pending', '2026-04-21'],
    ],
  );
});

test('queue follows send-back and resubmit without carrying approval or old version numbers', async () => {
  const api = createApiSubstitute();
  const owner = await signIn(api, 'fx-user-owner-cm');
  const reviewer = await signIn(api, 'fx-user-ai-coe');
  const stored = [...api.store.cases.values()].find((c) => c.fixtureCaseId === 'fx-case-nonvendor')!;
  const post = async (path: string, cookie: string, json: unknown) => {
    const response = await call(api, 'POST', path, {
      cookie,
      json,
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
    assert.equal(response.status, 201, response.text());
    return response;
  };
  const base = `/api/cases/${stored.caseId}`;
  const versionId = stored.draft!.draftId;
  await post(`${base}/draft/submit`, owner, { expectedVersion: { versionId, revision: 1 } });
  await post(`${base}/versions/${versionId}/lanes/ai_coe/send-back`, reviewer, {
    expectedVersion: { versionId, revision: 1 },
    feedback: { items: [{ slot: 5, deficiency: 'Synthetic correction' }] },
  });
  const returned = (
    await call(api, 'GET', '/api/queue?status=sent_back', { cookie: owner })
  ).json<QueueResponse>().items[0]!;
  assert.equal(returned.latestVersionNumber, 2);
  assert.equal(returned.currentVersionNumber, 1);
  assert.equal(returned.nextAction, 'correct_pack');
  assert.equal(returned.lanes.find((lane) => lane.lane === 'ai_coe')!.status, 'sent_back');
  await post(`${base}/draft/submit`, owner, {
    expectedVersion: { versionId: stored.draft!.draftId, revision: stored.caseRevision },
  });
  const submitted = (
    await call(api, 'GET', '/api/queue?status=in_review', { cookie: owner })
  ).json<QueueResponse>().items[0]!;
  assert.equal(submitted.currentVersionNumber, 2);
  assert.equal(submitted.latestVersionNumber, 2);
  assert.ok(submitted.lanes.every((lane) => lane.status === 'pending'));
});

test('queue keeps fixed-proposed findings outstanding until lane disposition completes Ready', async () => {
  const api = createApiSubstitute();
  const owner = await signIn(api, 'fx-user-owner-cm');
  const reviewers = {
    ai_coe: await signIn(api, 'fx-user-ai-coe'),
    dpo: await signIn(api, 'fx-user-dpo'),
    it_security: await signIn(api, 'fx-user-it-security'),
  };
  const stored = [...api.store.cases.values()].find((c) => c.fixtureCaseId === 'fx-case-vendor')!;
  const versionId = stored.draft!.draftId;
  const base = `/api/cases/${stored.caseId}`;
  const expectedVersion = { versionId, revision: 1 };
  const post = async (path: string, cookie: string, json: unknown, status = 201) => {
    const response = await call(api, 'POST', path, {
      cookie,
      json,
      headers: { 'idempotency-key': crypto.randomUUID() },
    });
    assert.equal(response.status, status, response.text());
    return response;
  };
  await post(`${base}/draft/submit`, owner, { expectedVersion });
  for (const [lane, cookie] of Object.entries(reviewers)) {
    const run = await post(
      `${base}/versions/${versionId}/lanes/${lane}/qc-run`,
      cookie,
      { expectedVersion },
      200,
    );
    await post(`${base}/versions/${versionId}/lanes/${lane}/approve`, cookie, {
      expectedVersion,
      qcRunId: run.json<{ runId: string }>().runId,
    });
  }
  const queue = async () =>
    (await call(api, 'GET', '/api/queue', { cookie: owner }))
      .json<QueueResponse>()
      .items.find((item) => item.caseId === stored.caseId)!;
  assert.equal((await queue()).status, 'awaiting_disposition');
  const findings = [...api.store.findings.values()].filter((finding) => finding.versionId === versionId);
  assert.ok(findings.length > 0);
  await post(`${base}/findings/${findings[0]!.findingId}/dispositions`, owner, {
    expectedVersion,
    kind: 'fixed_proposed',
    reason: 'Synthetic correction evidence',
  });
  assert.equal((await queue()).nextAction, 'resolve_findings');
  for (const finding of findings)
    await post(`${base}/findings/${finding.findingId}/dispositions`, reviewers[finding.owningLane], {
      expectedVersion,
      kind: 'waived',
      reason: 'Synthetic rehearsal waiver',
    });
  assert.equal((await queue()).status, 'ready_for_launch');
  assert.equal((await queue()).nextAction, 'review_complete');
});

test('queue combines filters within BU scope and unions grants for a multiple-role reviewer', async () => {
  const api = createApiSubstitute();
  const spoc = await signIn(api, 'fx-user-spoc-cm');
  const multi = await signIn(api, 'fx-user-dpo-spoc-hr');
  const bu = (await call(api, 'GET', '/api/queue', { cookie: spoc })).json<QueueResponse>();
  assert.ok(bu.total > 0 && bu.total < 5);
  assert.ok(bu.items.every((item) => item.businessUnitId === 'CM'));
  const item = bu.items[0]!;
  const query = new URLSearchParams({
    status: item.status,
    owner: item.businessOwner,
    useCaseGroup: item.useCaseGroup,
    search: item.useCaseName,
    searchBy: 'all',
  });
  const filtered = (
    await call(api, 'GET', '/api/queue?' + query.toString(), { cookie: spoc })
  ).json<QueueResponse>();
  assert.deepEqual(
    filtered.items.map((row) => row.caseId),
    [item.caseId],
  );
  assert.deepEqual(filtered.filterOptions, bu.filterOptions);
  assert.deepEqual(filtered.statusCounts, bu.statusCounts);
  const all = (await call(api, 'GET', '/api/queue', { cookie: multi })).json<QueueResponse>();
  assert.equal(all.total, 5);
});
