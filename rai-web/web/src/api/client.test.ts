// W1-07: the client maps the W0-06 8.2 envelope to ApiError without deciding anything, mints no key of its own,
// and treats a 404 on the fixture picker route as "not fixture mode" (W0-02 7.2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, NetworkError, createApiClient, type FetchLike } from './client.js';

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
