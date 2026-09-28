// W7-07 (W7 plan section 5.3): the in-product mail file drop against the W0-07 section 4.8 rows that hold for a file
// sink: a valid delivery, each validation code, duplicate, duplicate across a restart (a new instance over the same
// directory), a corrupt or foreign file ignored, concurrent attempts of one key (one delivered, one duplicate), file
// names equal to `mailFileStem`, the `{ request, receipt }` JSON shape, 0600 files in a 0700 directory, health and a
// write failure that leaves the key unaccepted. Synthetic values only; nothing is sent anywhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildDedupKey } from '@rai/shared/mail/dedup';
import { mailFileStem } from '@rai/shared/mail/file-stem';
import type {
  AuthorizedRecipient,
  CaseMailEvent,
  DeliveryReceipt,
  DeliveryRequest,
} from '@rai/shared/mail/types';
import { createFileDropMailSink } from './file-drop.js';

const BASE = 'http://127.0.0.1:8787';
const CASE_ID = '0192b3c4-0000-7000-8000-000000000701';
const VERSION_ID = '0192b3c4-0000-7000-8000-000000000702';
const AUDIT_EVENT_ID = '0192b3c4-0000-7000-8000-000000000703';
const CORRELATION_ID = '7f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e7';
const FIXED_NOW = () => new Date('2026-09-28T04:00:00.000Z');

const RECIPIENT: AuthorizedRecipient = {
  recipientId: 'google:w7-07-ai-coe',
  address: 'ai-coe.reviewer@rai-desk.example',
  displayName: 'AI CoE reviewer (synthetic)',
  locale: 'th',
  basis: 'case_view_scope',
};

function laneOpened(
  overrides: {
    recipient?: AuthorizedRecipient;
    attempt?: number;
    url?: string;
    subject?: string;
    event?: Partial<CaseMailEvent>;
  } = {},
): DeliveryRequest {
  const event: CaseMailEvent = {
    kind: 'lane_opened',
    caseId: CASE_ID,
    versionId: VERSION_ID,
    versionNumber: 1,
    digestDay: null,
    lane: 'ai_coe',
    auditEventId: AUDIT_EVENT_ID,
    committedAt: '2026-09-28T03:00:00.000Z',
    correlationId: CORRELATION_ID,
    ...overrides.event,
  };
  const recipient = overrides.recipient ?? RECIPIENT;
  const url = overrides.url ?? `${BASE}/cases/${CASE_ID}`;
  let dedupKey: string;
  try {
    dedupKey = buildDedupKey(event, recipient);
  } catch {
    dedupKey = `broken:${recipient.address}`;
  }
  return {
    dedupKey,
    event,
    recipient,
    deepLinks: [{ url, route: 'case', caseId: CASE_ID, requiresSignIn: true }],
    digestCases: null,
    mail: {
      subject: overrides.subject ?? 'แจ้งเตือน: เลนเปิดแล้ว',
      textBody: `เลน AI CoE เปิดสำหรับการตรวจสอบ v1\n\n${url}\n`,
      templateKey: 'mail.lane_opened',
      templateParams: { caseName: 'Synthetic case 701' },
    },
    attempt: overrides.attempt ?? 1,
  };
}

async function withDir(body: (dir: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rai-w7-07-drop-'));
  try {
    await body(path.join(root, 'mail'));
  } finally {
    await chmod(root, 0o700).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
}

const jsonFiles = async (dir: string) => (await readdir(dir)).filter((n) => n.endsWith('.json')).sort();

function assertFailed(receipt: DeliveryReceipt, code: string): void {
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.sinkMessageId, null);
  assert.equal(receipt.error?.code, code);
}

test('W7-07 file drop: identity is { sink: file, version: w7-07 }', () => {
  const sink = createFileDropMailSink({ dir: '/nonexistent', publicBaseUrl: new URL(BASE) });
  assert.deepEqual(sink.identity, { sink: 'file', version: 'w7-07' });
});

test('W7-07 file drop: a valid delivery writes <mailFileStem>.json ({ request, receipt }) and .txt, 0600 in a 0700 directory', () =>
  withDir(async (dir) => {
    const sink = createFileDropMailSink({ dir, publicBaseUrl: new URL(BASE), now: FIXED_NOW });
    const request = laneOpened({ attempt: 2 });
    const receipt = await sink.deliver(request);
    const stem = mailFileStem(request.dedupKey, 2);
    assert.deepEqual(receipt, {
      dedupKey: request.dedupKey,
      attempt: 2,
      at: '2026-09-28T04:00:00.000Z',
      status: 'delivered',
      sinkMessageId: `${stem}.json`,
      error: null,
    });
    assert.deepEqual((await readdir(dir)).sort(), [`${stem}.json`, `${stem}.txt`]);
    for (const name of await readdir(dir)) {
      assert.ok(!name.includes('@') && !name.includes('rai-desk'), 'no address in a file name');
      assert.equal((await stat(path.join(dir, name))).mode & 0o777, 0o600, `${name} is 0600`);
    }
    assert.equal((await stat(dir)).mode & 0o777, 0o700, 'the drop directory is 0700');
    const file = JSON.parse(await readFile(path.join(dir, `${stem}.json`), 'utf8')) as unknown;
    assert.deepEqual(file, { request, receipt });
    const text = await readFile(path.join(dir, `${stem}.txt`), 'utf8');
    assert.ok(text.startsWith(`To: ${RECIPIENT.address}\nSubject: ${request.mail.subject}\n`));
    assert.ok(text.includes('X-RAI-Sink: file (in-product drop; nothing was sent)\n'));
    assert.ok(text.includes(`X-RAI-Audit-Event-Id: ${AUDIT_EVENT_ID}\n`));
    assert.ok(text.endsWith(`\n\n${request.mail.textBody}\n`));
  }));

test('W7-07 file drop: each validation code answers failed and writes nothing', () =>
  withDir(async (dir) => {
    const sink = createFileDropMailSink({ dir, publicBaseUrl: new URL(BASE), now: FIXED_NOW });
    assertFailed(
      await sink.deliver(laneOpened({ url: `https://elsewhere.example/cases/${CASE_ID}` })),
      'unsafe_link',
    );
    assertFailed(
      await sink.deliver(laneOpened({ recipient: { ...RECIPIENT, address: 'someone@real-company.co.th' } })),
      'rejected_recipient',
    );
    assertFailed(await sink.deliver(laneOpened({ event: { auditEventId: '' } })), 'malformed_request');
    assertFailed(await sink.deliver(laneOpened({ subject: 'x'.repeat(999) })), 'sink_failure');
    assert.deepEqual(await readdir(dir).catch(() => []), [], 'nothing written for a rejected request');
  }));

test('W7-07 file drop: a delivered key answers duplicate and writes nothing, also on a new instance over the same directory', () =>
  withDir(async (dir) => {
    const first = createFileDropMailSink({ dir, publicBaseUrl: new URL(BASE) });
    const request = laneOpened();
    assert.equal((await first.deliver(request)).status, 'delivered');
    const again = await first.deliver({ ...request, attempt: 2 });
    assert.equal(again.status, 'duplicate');
    assert.equal(again.error?.code, 'duplicate');
    assert.equal(again.sinkMessageId, null);
    assert.equal((await jsonFiles(dir)).length, 1);

    const restarted = createFileDropMailSink({ dir, publicBaseUrl: new URL(BASE) });
    assert.equal((await restarted.deliver({ ...request, attempt: 3 })).status, 'duplicate');
    assert.equal((await jsonFiles(dir)).length, 1, 'nothing written after the restart either');
    const other = laneOpened({ recipient: { ...RECIPIENT, address: 'dpo.reviewer@rai-desk.example' } });
    assert.equal((await restarted.deliver(other)).status, 'delivered');
  }));

test('W7-07 file drop: a corrupt, foreign or failed-receipt file marks nothing accepted', () =>
  withDir(async (dir) => {
    const request = laneOpened();
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${mailFileStem(request.dedupKey, 1)}.json`), '{ not json');
    await writeFile(
      path.join(dir, `${mailFileStem(request.dedupKey, 2)}.json`),
      JSON.stringify({ request, receipt: { status: 'failed' } }),
    );
    await writeFile(
      path.join(dir, 'notes.json'),
      JSON.stringify({ request, receipt: { status: 'delivered' } }),
    );
    const sink = createFileDropMailSink({ dir, publicBaseUrl: new URL(BASE) });
    assert.equal((await sink.deliver({ ...request, attempt: 3 })).status, 'delivered');
  }));

test('W7-07 file drop: concurrent attempts of one key give one delivered and one duplicate', () =>
  withDir(async (dir) => {
    const sink = createFileDropMailSink({ dir, publicBaseUrl: new URL(BASE) });
    const request = laneOpened();
    const receipts = await Promise.all([
      sink.deliver(request),
      sink.deliver({ ...request, attempt: 2 }),
      sink.deliver({ ...request, attempt: 3 }),
    ]);
    assert.deepEqual(
      receipts.map((r) => r.status),
      ['delivered', 'duplicate', 'duplicate'],
    );
    assert.deepEqual(await jsonFiles(dir), [`${mailFileStem(request.dedupKey, 1)}.json`]);
  }));

test('W7-07 file drop: a write failure answers sink_failure with the errno code only and leaves the key unaccepted', () =>
  withDir(async (dir) => {
    const sink = createFileDropMailSink({ dir, publicBaseUrl: new URL(BASE) });
    const request = laneOpened();
    const stem = mailFileStem(request.dedupKey, 1);
    await mkdir(path.join(dir, `${stem}.json`), { recursive: true }); // rename onto a directory fails
    const failed = await sink.deliver(request);
    assertFailed(failed, 'sink_failure');
    assert.ok(!failed.error!.message.includes(dir), 'never the path');
    await rm(path.join(dir, `${stem}.json`), { recursive: true });
    assert.equal(
      (await sink.deliver(request)).status,
      'delivered',
      'the key was not accepted by the failure',
    );
    assert.deepEqual(
      (await readdir(dir)).filter((n) => n.endsWith('.tmp')),
      [],
      'no temporary file is left behind',
    );
  }));

test('W7-07 file drop: health() is ok for a writable directory (created on demand), unavailable otherwise', () =>
  withDir(async (dir) => {
    assert.equal(await createFileDropMailSink({ dir, publicBaseUrl: new URL(BASE) }).health(), 'ok');
    if (process.getuid?.() === 0) return; // root ignores mode bits
    const locked = path.join(path.dirname(dir), 'locked');
    await mkdir(locked);
    await chmod(locked, 0o500);
    try {
      const blocked = createFileDropMailSink({
        dir: path.join(locked, 'mail'),
        publicBaseUrl: new URL(BASE),
      });
      assert.equal(await blocked.health(), 'unavailable');
      const receipt = await blocked.deliver(laneOpened());
      assertFailed(receipt, 'sink_failure');
      assert.ok(!receipt.error!.message.includes(locked), 'never the path');
    } finally {
      await chmod(locked, 0o700);
    }
  }));

test('W7-07 file drop: a publicBaseUrl that is not a URL is refused at construction', () => {
  assert.throws(() => createFileDropMailSink({ dir: '/tmp', publicBaseUrl: 'not a url' }), RangeError);
});
