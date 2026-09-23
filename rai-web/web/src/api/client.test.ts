// W1-07: the client maps the W0-06 8.2 envelope to ApiError without deciding anything, mints no key of its own,
// and treats a 404 on the fixture picker route as "not fixture mode" (W0-02 7.2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DeskHealthReport } from '@rai/shared/schemas/observability';
import {
  ApiError,
  InvalidResponseError,
  NetworkError,
  artifactDownloadPath,
  createApiClient,
  type FetchLike,
} from './client.js';

function fetchAnswering(status: number, body: unknown, headers: Record<string, string> = {}): FetchLike {
  return () =>
    Promise.resolve(
      new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      }),
    );
}

test('a 403 envelope becomes an ApiError carrying code, messageKey and correlationId', async () => {
  const client = createApiClient(
    fetchAnswering(403, {
      error: { code: 'forbidden', messageKey: 'error.forbidden', correlationId: 'c-1' },
    }),
  );
  await assert.rejects(client.listCases(), (err: unknown) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 403);
    assert.equal(err.code, 'forbidden');
    assert.equal(err.messageKey, 'error.forbidden');
    assert.equal(err.correlationId, 'c-1');
    assert.deepEqual(err.fieldErrors, []);
    return true;
  });
});

test('a 422 invalid_input exposes its field errors', async () => {
  const client = createApiClient(
    fetchAnswering(422, {
      error: {
        code: 'invalid_input',
        messageKey: 'error.invalid_input',
        correlationId: 'c-2',
        details: { fields: [{ path: 'body.useCaseName', messageKey: 'validation.required' }] },
      },
    }),
  );
  await assert.rejects(client.getSession(), (err: unknown) => {
    assert.ok(err instanceof ApiError);
    assert.deepEqual(err.fieldErrors, [{ path: 'body.useCaseName', messageKey: 'validation.required' }]);
    return true;
  });
});

test('a non-JSON failure keeps the status and falls back to error.internal_error', async () => {
  const client = createApiClient(() =>
    Promise.resolve(new Response('<html>', { status: 502, headers: { 'x-correlation-id': 'c-3' } })),
  );
  await assert.rejects(client.getSession(), (err: unknown) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 502);
    assert.equal(err.code, 'unknown');
    assert.equal(err.messageKey, 'error.internal_error');
    assert.equal(err.correlationId, 'c-3');
    return true;
  });
});

test('a rejected fetch is a NetworkError, never a silent empty result', async () => {
  const client = createApiClient(() => Promise.reject(new TypeError('offline')));
  await assert.rejects(client.listCases(), (err: unknown) => err instanceof NetworkError);
});

test('the fixture picker route answering 404 means "not fixture mode" and is not an error', async () => {
  const client = createApiClient(
    fetchAnswering(404, { error: { code: 'not_found', messageKey: 'error.not_found', correlationId: 'c' } }),
  );
  assert.equal(await client.getFixtureUsers(), null);
});

test('createCase sends the caller-minted Idempotency-Key and the JSON body; listCases encodes the query', async () => {
  const calls: { input: string; init: RequestInit | undefined }[] = [];
  const client = createApiClient((input, init) => {
    calls.push({ input, init });
    return Promise.resolve(
      new Response(JSON.stringify({ items: [], page: 2, pageSize: 10, total: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  await client.listCases({ page: 2, pageSize: 10 });
  assert.equal(calls[0]?.input, '/api/cases?page=2&pageSize=10');
  assert.equal(calls[0]?.init?.credentials, 'same-origin');
  await client.createCase(
    {
      useCaseName: 'x',
      businessUnitId: 'CM',
      businessUnit: 'Consumer Mobile',
      businessOwner: 'fixture:fx-user-owner-cm',
      technicalOwner: 'y',
      sourceRecordId: { kind: 'unknown' },
      useCaseGroup: 'customer-analytics',
      vendorInvolved: false,
      modelType: 'llm',
    },
    'key-1',
  );
  const headers = calls[1]?.init?.headers as Record<string, string>;
  assert.equal(headers['idempotency-key'], 'key-1');
  assert.equal(headers['content-type'], 'application/json');
  assert.equal(calls[1]?.init?.method, 'POST');
});

test('a 204 resolves to undefined', async () => {
  const client = createApiClient(fetchAnswering(204, null));
  assert.equal(await client.signOut(), undefined);
});

test('W1-06: uploadArtifact sends one multipart part named `file` and lets the browser set the boundary', async () => {
  const calls: { input: string; init: RequestInit | undefined }[] = [];
  const client = createApiClient((input, init) => {
    calls.push({ input, init });
    return Promise.resolve(
      new Response(JSON.stringify({ artifactId: 'a-1' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  await client.uploadArtifact('c 1', new File(['%PDF-1.4'], 'synthetic.pdf', { type: 'application/pdf' }));
  assert.equal(calls[0]?.input, '/api/cases/c%201/artifacts');
  assert.equal(calls[0]?.init?.method, 'POST');
  const form = calls[0]?.init?.body;
  assert.ok(form instanceof FormData);
  assert.deepEqual([...form.keys()], ['file']);
  assert.equal((form.get('file') as File).name, 'synthetic.pdf');
  const headers = calls[0]?.init?.headers as Record<string, string>;
  assert.equal(headers['content-type'], undefined); // the boundary is the browser's to set
});

test('W1-06: saveDraft PUTs the body; submitDraft POSTs with the caller-minted key; version paths are encoded', async () => {
  const calls: { input: string; init: RequestInit | undefined }[] = [];
  const client = createApiClient((input, init) => {
    calls.push({ input, init });
    return Promise.resolve(
      new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  });
  const expectedVersion = { versionId: 'd-1', revision: 1 };
  await client.saveDraft('c1', { expectedVersion, slots: { 7: { state: 'missing' } } });
  assert.equal(calls[0]?.input, '/api/cases/c1/draft');
  assert.equal(calls[0]?.init?.method, 'PUT');
  const sent = JSON.parse(calls[0]?.init?.body as string) as { expectedVersion: { revision: number } };
  assert.equal(sent.expectedVersion.revision, 1);
  await client.submitDraft('c1', { expectedVersion }, 'key-7');
  assert.equal(calls[1]?.input, '/api/cases/c1/draft/submit');
  assert.equal((calls[1]?.init?.headers as Record<string, string>)['idempotency-key'], 'key-7');
  await client.getVersion('c1', 'v/2');
  assert.equal(calls[2]?.input, '/api/cases/c1/versions/v%2F2');
  await client.getArtifactMeta('a 1');
  assert.equal(calls[3]?.input, '/api/artifacts/a%201/meta');
  assert.equal(artifactDownloadPath('a 1'), '/api/artifacts/a%201');
});

test('W2-07: lane qc-run, approve and send-back paths carry expectedVersion and the mint key', async () => {
  const calls: { input: string; init: RequestInit | undefined }[] = [];
  const client = createApiClient((input, init) => {
    calls.push({ input, init });
    return Promise.resolve(
      new Response(JSON.stringify({ runId: 'r1', status: 'completed', findings: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  const expectedVersion = { versionId: 'v-1', revision: 1 };
  await client.runLaneQc('c1', 'v/1', 'ai_coe', { expectedVersion });
  assert.equal(calls[0]?.input, '/api/cases/c1/versions/v%2F1/lanes/ai_coe/qc-run');
  assert.equal(calls[0]?.init?.method, 'POST');
  await client.approveLane('c1', 'v1', 'dpo', { expectedVersion, qcRunId: 'r1' }, 'key-a');
  assert.equal(calls[1]?.input, '/api/cases/c1/versions/v1/lanes/dpo/approve');
  assert.equal((calls[1]?.init?.headers as Record<string, string>)['idempotency-key'], 'key-a');
  await client.sendBackLane(
    'c1',
    'v1',
    'it_security',
    {
      expectedVersion,
      // SlotNumberSchema Static is `never` (map construction); the runtime value is a slot 1..9.
      feedback: { items: [{ slot: 7, deficiency: 'needs assessment' }] } as never,
    },
    'key-b',
  );
  assert.equal(calls[2]?.input, '/api/cases/c1/versions/v1/lanes/it_security/send-back');
  assert.equal((calls[2]?.init?.headers as Record<string, string>)['idempotency-key'], 'key-b');
});

test('W2-09: recordDisposition path carries expectedVersion, kind and the mint key', async () => {
  const calls: { input: string; init: RequestInit | undefined }[] = [];
  const client = createApiClient((input, init) => {
    calls.push({ input, init });
    return Promise.resolve(
      new Response(
        JSON.stringify({
          dispositionId: 'd1',
          findingId: 'f1',
          kind: 'waived',
          recordedAt: '2026-09-22T12:00:00Z',
          caseRevision: 1,
          ready: false,
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      ),
    );
  });
  await client.recordDisposition(
    'c1',
    'f/1',
    {
      expectedVersion: { versionId: 'v-1', revision: 1 },
      kind: 'waived',
      reason: 'accepted residual risk',
    },
    'key-d',
  );
  assert.equal(calls[0]?.input, '/api/cases/c1/findings/f%2F1/dispositions');
  assert.equal(calls[0]?.init?.method, 'POST');
  assert.equal((calls[0]?.init?.headers as Record<string, string>)['idempotency-key'], 'key-d');
  const body = JSON.parse(calls[0]?.init?.body as string) as {
    kind: string;
    reason: string;
    expectedVersion: { versionId: string; revision: number };
  };
  assert.equal(body.kind, 'waived');
  assert.equal(body.reason, 'accepted residual risk');
  assert.equal(body.expectedVersion.revision, 1);
});

test('W2-09: listVersionFindings path is a GET under the version', async () => {
  const calls: { input: string; init: RequestInit | undefined }[] = [];
  const client = createApiClient((input, init) => {
    calls.push({ input, init });
    return Promise.resolve(
      new Response(JSON.stringify({ findings: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  await client.listVersionFindings('c1', 'v/1');
  assert.equal(calls[0]?.input, '/api/cases/c1/versions/v%2F1/findings');
  assert.equal(calls[0]?.init?.method ?? 'GET', 'GET');
});

test('W1-06: a 409 stale_version exposes its guidance and refresh path; other codes expose none', async () => {
  const client = createApiClient(
    fetchAnswering(409, {
      error: {
        code: 'stale_version',
        messageKey: 'error.stale_version',
        correlationId: 'c-9',
        details: {
          guidanceKey: 'error.stale_version.guidance.revision_changed',
          current: { versionId: 'd-1', revision: 2 },
          refreshPath: '/cases/c1',
        },
      },
    }),
  );
  await assert.rejects(client.getDraft('c1'), (err: unknown) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.stale?.guidanceKey, 'error.stale_version.guidance.revision_changed');
    assert.equal(err.stale?.refreshPath, '/cases/c1');
    return true;
  });
  const forbidden = createApiClient(
    fetchAnswering(403, { error: { code: 'forbidden', messageKey: 'error.forbidden', correlationId: 'c' } }),
  );
  await assert.rejects(
    forbidden.getDraft('c1'),
    (err: unknown) => err instanceof ApiError && err.stale === undefined,
  );
});

test('a 422 unsafe_upload exposes its reason key and limit params; other codes expose none', async () => {
  const client = createApiClient(
    fetchAnswering(422, {
      error: {
        code: 'unsafe_upload',
        messageKey: 'error.unsafe_upload',
        correlationId: 'c-10',
        details: { reasonKey: 'error.unsafe_upload.too_large', params: { max_file_mb: 25 } },
      },
    }),
  );
  await assert.rejects(client.uploadArtifact('c1', new File([], 'a.pdf')), (err: unknown) => {
    assert.ok(err instanceof ApiError);
    assert.deepEqual(err.unsafeUpload, {
      reasonKey: 'error.unsafe_upload.too_large',
      params: { max_file_mb: 25 },
    });
    assert.equal(err.stale, undefined);
    return true;
  });
  const forbidden = createApiClient(
    fetchAnswering(403, { error: { code: 'forbidden', messageKey: 'error.forbidden', correlationId: 'c' } }),
  );
  await assert.rejects(
    forbidden.uploadArtifact('c1', new File([], 'a.pdf')),
    (err: unknown) => err instanceof ApiError && err.unsafeUpload === undefined,
  );
});

test('queue client preserves literal Thai filters, pagination and server response without applying scope', async () => {
  const response = {
    items: [],
    total: 0,
    page: 2,
    pageSize: 10,
    filterOptions: { statuses: [], owners: [], useCaseGroups: [] },
    statusCounts: { draft: 0, in_review: 0, sent_back: 0, awaiting_disposition: 0, ready_for_launch: 0 },
  };
  const client = createApiClient((input, init) => {
    const url = new URL(input, 'http://localhost');
    assert.equal(url.pathname, '/api/queue');
    assert.equal(url.searchParams.get('search'), 'ชื่อ%_');
    assert.equal(url.searchParams.get('searchBy'), 'owner');
    assert.equal(url.searchParams.get('owner'), 'synthetic:owner');
    assert.equal(url.searchParams.get('status'), 'sent_back');
    assert.equal(url.searchParams.get('useCaseGroup'), 'group');
    assert.equal(url.searchParams.get('page'), '2');
    assert.equal(url.searchParams.get('pageSize'), '10');
    assert.equal(init?.credentials, 'same-origin');
    return Promise.resolve(new Response(JSON.stringify(response)));
  });
  assert.deepEqual(
    await client.getQueue({
      search: 'ชื่อ%_',
      searchBy: 'owner',
      owner: 'synthetic:owner',
      status: 'sent_back',
      useCaseGroup: 'group',
      page: 2,
      pageSize: 10,
    }),
    response,
  );
});

const operatorId = '11111111-1111-4111-8111-111111111111';
const operatorTime = '2026-09-22T00:00:00.000Z';
function deskHealthReport(): DeskHealthReport {
  return {
    generatedAt: operatorTime,
    readiness: {
      status: 'ready',
      checkedAt: operatorTime,
      identity: { mode: 'fixture', loopbackBind: true, status: 'ok' },
      store: { db: 'ok', migrations: 'current', blob: 'ok' },
      mailSink: { kind: 'file', status: 'ok' },
      qc: { kind: 'substitute', status: 'disabled' },
      build: { commit: 'dev', schemaVersion: '7' },
    },
    failedMail: [
      {
        notificationId: operatorId,
        eventType: 'sla_breach_digest',
        recipient: 'operator@rai-desk.example',
        correlationId: operatorId,
        status: 'queued',
        attempts: 1,
        lastErrorCode: 'sink_failure',
      },
    ],
    unavailableQc: [
      {
        qcRunId: operatorId,
        caseId: operatorId,
        versionId: operatorId,
        trigger: 'submit',
        reason: 'unknown',
        requestedAt: operatorTime,
        correlationId: operatorId,
      },
    ],
    lateQc: [
      {
        lateResultId: operatorId,
        qcRunId: operatorId,
        caseId: operatorId,
        versionId: operatorId,
        trigger: 'approve_attempt',
        lane: 'dpo',
        status: 'completed',
        refusedFindingCount: 0,
        recordedAt: operatorTime,
        correlationId: operatorId,
      },
    ],
    slaDigest: { recentFailures: [] },
    errorCounters: [{ code: 'mail_delivery_failed', count: 1, lastAt: operatorTime }],
  };
}

test('operator client uses canonical same-origin GET and preserves absent optional fields', async () => {
  const report = deskHealthReport();
  const client = createApiClient((input, init) => {
    assert.equal(input, '/api/operator/desk-health');
    assert.equal(init?.method, 'GET');
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(init?.body, undefined);
    return Promise.resolve(new Response(JSON.stringify(report)));
  });
  const result = await client.getDeskHealth();
  assert.deepEqual(result, report);
  assert.equal(Object.hasOwn(result.failedMail[0]!, 'nextAttemptAt'), false);
  assert.equal(Object.hasOwn(result.slaDigest, 'lastRun'), false);
  assert.equal(result.unavailableQc[0]!.reason, 'unknown');
});

test('operator client preserves terminal failure and digest provenance without deriving state', async () => {
  const report = deskHealthReport();
  report.failedMail = [
    {
      notificationId: operatorId,
      eventType: 'send_back',
      caseId: operatorId,
      versionId: operatorId,
      lane: 'dpo',
      recipient: 'owner@rai-desk.example',
      correlationId: operatorId,
      status: 'failed',
      attempts: 4,
      lastErrorCode: 'sink_failure',
      failureCategory: 'mail_delivery_failed',
    },
  ];
  report.slaDigest = {
    lastRun: {
      jobRunId: operatorId,
      digestDay: '2026-09-22',
      startedAt: operatorTime,
      status: 'running',
      notificationIds: [],
      correlationId: operatorId,
    },
    recentFailures: [
      {
        jobRunId: operatorId,
        digestDay: '2026-09-21',
        startedAt: operatorTime,
        stage: 'enqueue',
        errorCode: 'enqueue_failed',
        correlationId: operatorId,
      },
    ],
  };
  assert.deepEqual(await createApiClient(fetchAnswering(200, report)).getDeskHealth(), report);
});

for (const status of [401, 403]) {
  test(`operator client preserves ${status} and its correlation instead of returning an empty report`, async () => {
    const code = status === 401 ? 'unauthenticated' : 'forbidden';
    await assert.rejects(
      createApiClient(
        fetchAnswering(status, {
          error: { code, messageKey: `error.${code}`, correlationId: operatorId },
        }),
      ).getDeskHealth(),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, status);
        assert.equal(err.code, code);
        assert.equal(err.correlationId, operatorId);
        return true;
      },
    );
  });
}

test('operator client rejects invalid success payloads with a safe error and no retained report', async () => {
  const report = deskHealthReport();
  const queued = report.failedMail[0]!;
  for (const payload of [
    {},
    null,
    { ...report, readiness: { ...report.readiness, status: 'healthy' } },
    { ...report, failedMail: [{ ...queued, nextAttemptAt: null }] },
    { ...report, failedMail: [{ ...queued, status: 'failed', attempts: 4 }] },
    { ...report, failedMail: [{ ...queued, attempts: 4 }] },
    { ...report, failedMail: [{ ...queued, failureCategory: 'mail_delivery_failed' }] },
    { ...report, unavailableQc: [{ ...report.unavailableQc[0], reason: 'raw provider exception' }] },
    { ...report, failedMail: Array.from({ length: 101 }, () => queued) },
    { ...report, secret: 'private-report-sentinel' },
  ]) {
    await assert.rejects(createApiClient(fetchAnswering(200, payload)).getDeskHealth(), (err: unknown) => {
      assert.ok(err instanceof InvalidResponseError);
      assert.equal(err.messageKey, 'operator.invalid_response');
      assert.equal(err.message, 'invalid_response');
      assert.equal(err.cause, undefined);
      assert.doesNotMatch(JSON.stringify(err), /operator@|private-report-sentinel|raw provider/);
      return true;
    });
  }
  await assert.rejects(createApiClient(fetchAnswering(204, null)).getDeskHealth(), InvalidResponseError);
});

test('operator client preserves HTTP and network failures instead of treating them as healthy or empty', async () => {
  await assert.rejects(
    createApiClient(fetchAnswering(500, {})).getDeskHealth(),
    (err: unknown) => err instanceof ApiError && err.status === 500,
  );
  await assert.rejects(
    createApiClient(() => Promise.reject(new Error('offline'))).getDeskHealth(),
    NetworkError,
  );
  await assert.rejects(
    createApiClient(() => Promise.resolve(new Response('<html>unavailable</html>'))).getDeskHealth(),
    NetworkError,
  );
});
