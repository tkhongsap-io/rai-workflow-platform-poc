// W6-11 (W6 plan sections 1.2 Q16 and 6): the kinds edited as schema-validated JSON. The page shows the body as
// indented JSON and sends only a JSON object; every schema rule is the server's (`publishProblems`), listed after a
// save. Synthetic values only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSimpleKind } from './simple-kinds.js';
import { JSON_KINDS, isJsonKind, jsonTextOf, parseJsonBody } from './json-kinds.js';

test('group_role_mapping is edited as JSON; no simple kind is, and unknown names are not', () => {
  assert.deepEqual([...JSON_KINDS], ['group_role_mapping']);
  assert.equal(isJsonKind('group_role_mapping'), true);
  for (const kind of ['sla', 'qc_rules', 'desk_controls', 'lane_mapping', 'toString', 'constructor'])
    assert.equal(isJsonKind(kind), false, kind);
  for (const kind of JSON_KINDS) assert.equal(isSimpleKind(kind), false, kind);
});

test('the text of a body is indented JSON; no body starts from an empty object', () => {
  const body = {
    kind: 'identity.group_role_mapping',
    version: 1,
    tenantId: '00000000-0000-0000-0000-000000000000',
    rules: [{ groupObjectId: 'fx-group-dpo', role: 'dpo' }],
  };
  const text = jsonTextOf(body);
  assert.equal(text, JSON.stringify(body, null, 2));
  assert.deepEqual(parseJsonBody(text), { ok: true, body });
  assert.equal(jsonTextOf(undefined), '{}');
});

test('only a JSON object is a body: invalid JSON, arrays, strings, numbers and null are refused in the page', () => {
  for (const text of ['', '   ', '{', '{"a":}', '[]', '[1]', '"x"', '3', 'null', 'true', "{'a': 1}"])
    assert.deepEqual(parseJsonBody(text), { ok: false }, JSON.stringify(text));
  assert.deepEqual(parseJsonBody(' { "a" : [1, "b"] } '), { ok: true, body: { a: [1, 'b'] } });
  assert.deepEqual(parseJsonBody('{}'), { ok: true, body: {} });
});
