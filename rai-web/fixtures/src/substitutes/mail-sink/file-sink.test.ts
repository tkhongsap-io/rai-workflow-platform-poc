// W0-07 section 4.8 rows specific to FileMailSink: restart keeps `duplicate`, file naming from the hashed dedup
// key (never the address), and nothing sensitive on disk (threat model).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, chmod, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileMailSink, mailFileStem, type MailSinkFile } from './file.js';
import {
  AI_COE_RECIPIENT,
  CASE_ID,
  CORRELATION_ID,
  AUDIT_EVENT_ID,
  laneOpenedRequest,
  PUBLIC_BASE_URL,
} from './support.js';

async function withDir(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rai-w1-11-file-'));
  try {
    await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('file sink restart: two receipts, a new FileMailSink on the same directory, a redelivered key is duplicate', () =>
  withDir(async (dir) => {
    const first = new FileMailSink({ publicBaseUrl: PUBLIC_BASE_URL, dir });
    const a = laneOpenedRequest();
    const b = laneOpenedRequest({ recipient: { ...AI_COE_RECIPIENT, address: 'dpo@rai-desk.example' } });
    assert.equal((await first.deliver(a)).status, 'delivered');
    assert.equal((await first.deliver(b)).status, 'delivered');
    assert.equal((await readdir(dir)).filter((n) => n.endsWith('.json')).length, 2);

    const second = new FileMailSink({ publicBaseUrl: PUBLIC_BASE_URL, dir });
    assert.equal(second.sent.length, 0, 'the in-process record starts empty');
    const again = await second.deliver({ ...a, attempt: 2 });
    assert.equal(again.status, 'duplicate');
    assert.equal((await readdir(dir)).filter((n) => n.endsWith('.json')).length, 2, 'nothing written');
    const fresh = laneOpenedRequest({ recipient: { ...AI_COE_RECIPIENT, address: 'ops@rai-desk.test' } });
    assert.equal((await second.deliver(fresh)).status, 'delivered');
  }));

test('a failed attempt on disk does not mark the key accepted; only a delivered receipt does', () =>
  withDir(async (dir) => {
    const first = new FileMailSink({ publicBaseUrl: PUBLIC_BASE_URL, dir });
    const request = laneOpenedRequest();
    first.failNext(1);
    assert.equal((await first.deliver(request)).status, 'failed');
    assert.equal((await readdir(dir)).length, 0, 'a forced failure writes nothing');
    // a foreign or half-written file marks nothing accepted either
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(dir, `${mailFileStem(request.dedupKey, 1)}.json`), '{ not json', 'utf8');
    const second = new FileMailSink({ publicBaseUrl: PUBLIC_BASE_URL, dir });
    assert.equal((await second.deliver({ ...request, attempt: 2 })).status, 'delivered');
  }));

test('one JSON and one text file per attempt, named from sha256(dedupKey) and the attempt, never the address', () =>
  withDir(async (dir) => {
    const sink = new FileMailSink({ publicBaseUrl: PUBLIC_BASE_URL, dir });
    const request = laneOpenedRequest({ attempt: 3 });
    const receipt = await sink.deliver(request);
    const stem = `${createHash('sha256').update(request.dedupKey).digest('hex').slice(0, 16)}-3`;
    assert.equal(receipt.sinkMessageId, `${stem}.json`);
    const names = (await readdir(dir)).sort();
    assert.deepEqual(names, [`${stem}.json`, `${stem}.txt`]);
    for (const name of names) {
      assert.ok(!name.includes('@'), 'no address in a file name');
      assert.ok(!name.includes('rai-desk'), 'no domain in a file name');
      assert.ok(!name.includes(CASE_ID), 'no case id in a file name');
    }
    const file = JSON.parse(await readFile(path.join(dir, `${stem}.json`), 'utf8')) as MailSinkFile;
    assert.deepEqual(file.request, request);
    assert.equal(file.receipt.status, 'delivered');
    assert.equal(file.receipt.sinkMessageId, `${stem}.json`);
    assert.equal(file.request.event.correlationId, CORRELATION_ID);
    const text = await readFile(path.join(dir, `${stem}.txt`), 'utf8');
    assert.ok(text.includes(`Subject: ${request.mail.subject}`));
    assert.ok(text.includes(`X-RAI-Correlation-Id: ${CORRELATION_ID}`));
    assert.ok(text.includes(request.deepLinks[0]!.url));
    assert.ok(text.endsWith(`${request.mail.textBody}\n`));
  }));

test('no secrets or contents on disk: deep links and IDs present; sentinel, config values and actor email absent', () =>
  withDir(async (dir) => {
    // the environment carries password-like values; the sink must not copy anything from it
    process.env.RAI_W1_11_TEST_PASSWORD = 'never-on-disk-3f9a';
    process.env.DATABASE_MIGRATE_URL = 'postgres://rai_owner:owner-secret-7c1@127.0.0.1:54331/rai';
    try {
      const sink = new FileMailSink({ publicBaseUrl: PUBLIC_BASE_URL, dir });
      const request = laneOpenedRequest();
      assert.equal((await sink.deliver(request)).status, 'delivered');
      const contents = (
        await Promise.all((await readdir(dir)).map((n) => readFile(path.join(dir, n), 'utf8')))
      ).join('\n');
      assert.ok(contents.includes(request.deepLinks[0]!.url));
      assert.ok(contents.includes(CASE_ID));
      assert.ok(contents.includes(AUDIT_EVENT_ID));
      assert.ok(contents.includes(CORRELATION_ID));
      assert.ok(!contents.includes('RAI-DESK-SYNTHETIC-FIXTURE'), 'the W0-08 fixture sentinel');
      assert.ok(!contents.includes('never-on-disk-3f9a'), 'a password-like config value');
      assert.ok(!contents.includes('owner-secret-7c1'), 'a database password');
      assert.ok(!contents.includes('owner.cm@rai-desk.example'), "the audit event's actor email");
    } finally {
      delete process.env.RAI_W1_11_TEST_PASSWORD;
      delete process.env.DATABASE_MIGRATE_URL;
    }
  }));

test('health() is ok for a writable directory (created on demand) and unavailable for an unwritable one', () =>
  withDir(async (dir) => {
    const nested = path.join(dir, 'a', 'b', 'mail');
    const sink = new FileMailSink({ publicBaseUrl: PUBLIC_BASE_URL, dir: nested });
    assert.equal(await sink.health(), 'ok');
    if (process.getuid?.() === 0) return; // root ignores mode bits; the unwritable half is not observable
    const locked = path.join(dir, 'locked');
    await mkdir(locked);
    await chmod(locked, 0o500);
    try {
      const blocked = new FileMailSink({ publicBaseUrl: PUBLIC_BASE_URL, dir: path.join(locked, 'mail') });
      assert.equal(await blocked.health(), 'unavailable');
      const receipt = await blocked.deliver(laneOpenedRequest());
      assert.equal(receipt.status, 'failed');
      assert.equal(receipt.error?.code, 'sink_failure');
      assert.ok(!receipt.error?.message.includes(locked), 'never the path');
    } finally {
      await chmod(locked, 0o700);
    }
  }));
