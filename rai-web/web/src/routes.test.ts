// W0-02 7.2: returnTo is a same-origin path only; anything else is dropped so a link alone never redirects away.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROUTES, safeReturnTo } from './routes.js';

test('safeReturnTo keeps SPA paths and drops absolute URLs, protocol-relative paths and the sign-in page', () => {
  assert.equal(safeReturnTo('/cases/abc'), '/cases/abc');
  assert.equal(safeReturnTo('/cases?page=2'), '/cases?page=2');
  assert.equal(safeReturnTo('https://evil.example/'), undefined);
  assert.equal(safeReturnTo('//evil.example/'), undefined);
  assert.equal(safeReturnTo('/\\evil.example'), undefined);
  assert.equal(safeReturnTo('/sign-in'), undefined);
  assert.equal(safeReturnTo('/sign-in?returnTo=/cases'), undefined);
  assert.equal(safeReturnTo(null), undefined);
  assert.equal(safeReturnTo(undefined), undefined);
});

test('the case and version paths encode their ids', () => {
  assert.equal(ROUTES.case('a b'), '/cases/a%20b');
  assert.equal(ROUTES.caseVersion('c 1', 'v/2'), '/cases/c%201/versions/v%2F2');
});

test('queue route is additive and its filtered return path survives sign-in', () => {
  assert.equal(ROUTES.queue, '/queue');
  assert.equal(ROUTES.cases, '/cases');
  assert.equal(safeReturnTo('/queue?status=draft&page=2'), '/queue?status=draft&page=2');
});
