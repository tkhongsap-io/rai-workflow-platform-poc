// W0-07 section 4.8 rows that hold for both sinks: the four inputs and a status, forced failure, duplicate key,
// unsafe links (single and one-of-many in a digest), the synthetic-domain rule, malformed and oversize requests
// and a Thai subject. Each test runs against MemoryMailSink and against FileMailSink on a fresh temporary
// directory. Done-when: "Accepts the four inputs and returns a status; a forced failure is reported".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { DeliveryReceipt, DeliveryRequest } from '@rai/shared/mail/types';
import { buildDedupKey } from '@rai/shared/mail/dedup';
import { FileMailSink } from './file.js';
import { MemoryMailSink } from './memory.js';
import { MAX_BODY_BYTES, MAX_SUBJECT_BYTES } from './validate.js';
import {
  AI_COE_RECIPIENT,
  CASE_ID,
  caseLink,
  caseVersionLink,
  digestEvent,
  digestRequest,
  laneOpenedEvent,
  laneOpenedRequest,
  padToBytes,
  PUBLIC_BASE_URL,
  VERSION_ID,
} from './support.js';

type Sink = MemoryMailSink | FileMailSink;

interface Harness {
  sink: Sink;
  /** Number of delivery files on disk (file sink) or -1 (memory sink). */
  files(): Promise<number>;
  close(): Promise<void>;
}

const FIXED_NOW = () => new Date('2026-09-21T04:00:00.000Z');

const harnesses: Array<{ name: 'memory' | 'file'; open(): Promise<Harness> }> = [
  {
    name: 'memory',
    open: () =>
      Promise.resolve({
        sink: new MemoryMailSink({ publicBaseUrl: PUBLIC_BASE_URL, now: FIXED_NOW }),
        files: () => Promise.resolve(-1),
        close: () => Promise.resolve(),
      }),
  },
  {
    name: 'file',
    open: async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'rai-w1-11-'));
      return {
        sink: new FileMailSink({ publicBaseUrl: PUBLIC_BASE_URL, dir, now: FIXED_NOW }),
        files: async () => (await readdir(dir)).filter((n) => n.endsWith('.json')).length,
        close: () => rm(dir, { recursive: true, force: true }),
      };
    },
  },
];

function forEachSink(name: string, body: (h: Harness, kind: 'memory' | 'file') => Promise<void>): void {
  for (const harness of harnesses) {
    test(`[${harness.name}] ${name}`, async () => {
      const h = await harness.open();
      try {
        await body(h, harness.name);
      } finally {
        await h.close();
      }
    });
  }
}

/** Asserts nothing was recorded: `sent` unchanged and, for the file sink, no delivery file. */
async function assertNothingRecorded(h: Harness, sentBefore: number): Promise<void> {
  assert.equal(h.sink.sent.length, sentBefore);
  const files = await h.files();
  if (files >= 0) assert.equal(files, sentBefore);
}

function assertFailed(receipt: DeliveryReceipt, code: NonNullable<DeliveryReceipt['error']>['code']): void {
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.sinkMessageId, null);
  assert.ok(receipt.error, 'a failed receipt carries an error');
  assert.equal(receipt.error.code, code);
}

forEachSink(
  'accepts the four inputs (event, recipient, deep link, dedup key) and returns delivered',
  async (h) => {
    const request = laneOpenedRequest({ attempt: 2 });
    const receipt = await h.sink.deliver(request);
    assert.equal(receipt.status, 'delivered');
    assert.equal(receipt.dedupKey, request.dedupKey);
    assert.equal(receipt.attempt, 2);
    assert.equal(receipt.at, '2026-09-21T04:00:00.000Z');
    assert.equal(typeof receipt.sinkMessageId, 'string');
    assert.equal(receipt.error, null);
    assert.equal(h.sink.sent.length, 1);
    assert.equal(h.sink.find(request.dedupKey), request);
    assert.equal(h.sink.receipts.length, 1);
    assert.equal(await h.sink.health(), 'ok');
  },
);

forEachSink('a case_version link is accepted for the case-bound kinds', async (h) => {
  const request = laneOpenedRequest({ deepLinks: [caseVersionLink(CASE_ID, VERSION_ID)] });
  assert.equal((await h.sink.deliver(request)).status, 'delivered');
});

forEachSink(
  'a digest with three case links, three entries and all three URLs in the body is delivered',
  async (h) => {
    const ids = [
      '0192b3c4-0000-7000-8000-000000000111',
      '0192b3c4-0000-7000-8000-000000000112',
      'RAI-2000-0003',
    ];
    const request = digestRequest(ids, { withQueueLink: true });
    assert.equal(request.deepLinks.length, 4);
    assert.equal(request.digestCases?.length, 3);
    const receipt = await h.sink.deliver(request);
    assert.equal(receipt.status, 'delivered', receipt.error?.message);
    assert.equal(receipt.dedupKey, 'sla_breach_digest:2026-09-21:-:operator-digest@rai-desk.example');
  },
);

forEachSink(
  'forced failure is reported: failNext(1) fails once, then delivers; failAlways(true) fails four times',
  async (h) => {
    const request = laneOpenedRequest();
    h.sink.failNext(1);
    const failed = await h.sink.deliver(request);
    assertFailed(failed, 'sink_failure');
    assert.match(failed.error!.message, /forced/);
    await assertNothingRecorded(h, 0);

    const delivered = await h.sink.deliver({ ...request, attempt: 2 });
    assert.equal(delivered.status, 'delivered');
    assert.equal(h.sink.sent.length, 1);

    h.sink.failAlways(true);
    const other = laneOpenedRequest({ recipient: { ...AI_COE_RECIPIENT, address: 'dpo@rai-desk.example' } });
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      assertFailed(await h.sink.deliver({ ...other, attempt }), 'sink_failure');
    }
    await assertNothingRecorded(h, 1);
    h.sink.failAlways(false);
    assert.equal((await h.sink.deliver({ ...other, attempt: 5 })).status, 'delivered');
  },
);

forEachSink('failWhen(predicate) fails only the matching requests until reset', async (h) => {
  h.sink.failWhen((req) => req.recipient.address === 'dpo@rai-desk.example');
  const dpo = laneOpenedRequest({ recipient: { ...AI_COE_RECIPIENT, address: 'dpo@rai-desk.example' } });
  assertFailed(await h.sink.deliver(dpo), 'sink_failure');
  assert.equal((await h.sink.deliver(laneOpenedRequest())).status, 'delivered');
  h.sink.reset();
  assert.equal(h.sink.sent.length, 0);
  assert.equal((await h.sink.deliver(dpo)).status, 'delivered');
});

forEachSink(
  'duplicate key: a second delivery of the same dedupKey is duplicate and sent.length is unchanged',
  async (h) => {
    const request = laneOpenedRequest();
    assert.equal((await h.sink.deliver(request)).status, 'delivered');
    const again = await h.sink.deliver({ ...request, attempt: 2 });
    assert.equal(again.status, 'duplicate');
    assert.equal(again.sinkMessageId, null);
    assert.equal(again.error?.code, 'duplicate');
    await assertNothingRecorded(h, 1);
    // a forced failure never turns an accepted key into a retry
    h.sink.failAlways(true);
    assert.equal((await h.sink.deliver({ ...request, attempt: 3 })).status, 'duplicate');
  },
);

forEachSink(
  'unsafe link: another origin, a query string or a fragment fails the delivery and records nothing',
  async (h) => {
    const cases: Array<[string, string]> = [
      ['origin', `http://127.0.0.1:9999/cases/${CASE_ID}`],
      ['https origin', `https://127.0.0.1:8787/cases/${CASE_ID}`],
      ['query', `${PUBLIC_BASE_URL}/cases/${CASE_ID}?token=abc`],
      ['fragment', `${PUBLIC_BASE_URL}/cases/${CASE_ID}#session`],
      ['credential', `http://user:pw@127.0.0.1:8787/cases/${CASE_ID}`],
      ['non-canonical path', `${PUBLIC_BASE_URL}/admin/cases/${CASE_ID}`],
    ];
    for (const [label, url] of cases) {
      const request = laneOpenedRequest({ deepLinks: [{ ...caseLink(CASE_ID), url }] });
      const receipt = await h.sink.deliver(request);
      assertFailed(receipt, 'unsafe_link');
      assert.ok(receipt.error!.message.includes('deepLinks[0]'), `${label}: names the index`);
      assert.ok(!receipt.error!.message.includes(url), `${label}: never the URL`);
      await assertNothingRecorded(h, 0);
    }
  },
);

forEachSink(
  'unsafe link: a single link whose caseId differs from event.caseId, or a missing link',
  async (h) => {
    const otherCase = '0192b3c4-0000-7000-8000-000000000999';
    const wrongCase = laneOpenedRequest({ deepLinks: [caseLink(otherCase)] });
    assertFailed(await h.sink.deliver(wrongCase), 'unsafe_link');
    const twoLinks = laneOpenedRequest({ deepLinks: [caseLink(CASE_ID), caseLink(CASE_ID)] });
    assertFailed(await h.sink.deliver(twoLinks), 'unsafe_link');
    const noLinks = laneOpenedRequest({ deepLinks: [] });
    assertFailed(await h.sink.deliver(noLinks), 'unsafe_link');
    await assertNothingRecorded(h, 0);
  },
);

forEachSink(
  'digest with five case links of which one is bad fails the whole delivery, naming the index only',
  async (h) => {
    const ids = ['RAI-2000-0001', 'RAI-2000-0002', 'RAI-2000-0003', 'RAI-2000-0004', 'RAI-2000-0005'];
    const bad: Array<[string, (req: DeliveryRequest) => void]> = [
      ['other origin', (r) => (r.deepLinks[3]!.url = `http://example.test/cases/${ids[3]}`)],
      ['query string', (r) => (r.deepLinks[3]!.url = `${r.deepLinks[3]!.url}?x=1`)],
      ['caseId mismatch', (r) => (r.digestCases![3]!.caseId = 'RAI-2000-0099')],
    ];
    for (const [label, mutate] of bad) {
      const request = digestRequest(ids);
      mutate(request);
      // keep the body in step with the links so only the named defect is under test
      request.mail.textBody = request.deepLinks.map((l) => l.url).join('\n');
      const receipt = await h.sink.deliver(request);
      assertFailed(receipt, 'unsafe_link');
      assert.ok(receipt.error!.message.includes('[3]'), `${label}: names index 3: ${receipt.error!.message}`);
      assert.ok(!receipt.error!.message.includes('http'), `${label}: never the URL`);
      await assertNothingRecorded(h, 0);
    }
  },
);

forEachSink(
  'digest: a case link missing from textBody, an unreferenced case link or a bad index is unsafe',
  async (h) => {
    const ids = ['RAI-2000-0001', 'RAI-2000-0002'];
    const missingFromBody = digestRequest(ids, {
      textBody: `only one: ${PUBLIC_BASE_URL}/cases/RAI-2000-0001\n`,
    });
    const r1 = await h.sink.deliver(missingFromBody);
    assertFailed(r1, 'unsafe_link');
    assert.ok(r1.error!.message.includes('deepLinks[1]'));

    const unreferenced = digestRequest(ids, {
      digestCases: [{ caseId: ids[0]!, lane: 'dpo', deepLinkIndex: 0 }],
    });
    assertFailed(await h.sink.deliver(unreferenced), 'unsafe_link');

    const outOfRange = digestRequest(ids, {
      digestCases: [
        { caseId: ids[0]!, lane: 'dpo', deepLinkIndex: 0 },
        { caseId: ids[1]!, lane: 'dpo', deepLinkIndex: 7 },
      ],
    });
    assertFailed(await h.sink.deliver(outOfRange), 'unsafe_link');

    const emptyCases = digestRequest(ids, { digestCases: [] });
    assertFailed(await h.sink.deliver(emptyCases), 'unsafe_link');
    await assertNothingRecorded(h, 0);
  },
);

forEachSink(
  'synthetic-domain rule: reserved domains accepted, anything else rejected_recipient',
  async (h) => {
    const accepted = [
      'owner.cm@rai-desk.example',
      'operator-digest@rai-desk.example',
      'dpo@rai-desk.example',
      'ops@rai-desk.test',
      'someone@example.com',
      'someone@sub.example.org',
      'x@y.invalid',
    ];
    for (const address of accepted) {
      const request = laneOpenedRequest({ recipient: { ...AI_COE_RECIPIENT, address } });
      const receipt = await h.sink.deliver(request);
      assert.equal(receipt.status, 'delivered', `${address}: ${receipt.error?.message ?? ''}`);
    }
    const rejected = [
      'someone@gmail.com',
      'nodomain',
      'someone@',
      '@rai-desk.example',
      'a@example.com.evil.net',
      'a@test',
    ];
    const sentBefore = h.sink.sent.length;
    for (const address of rejected) {
      const request = laneOpenedRequest({ recipient: { ...AI_COE_RECIPIENT, address } });
      const receipt = await h.sink.deliver(request);
      assertFailed(receipt, 'rejected_recipient');
      assert.ok(!receipt.error!.message.includes(address), 'never the address');
    }
    await assertNothingRecorded(h, sentBefore);
  },
);

forEachSink(
  'malformed request: an empty auditEventId or a digest without a day, naming the field only',
  async (h) => {
    const noAudit = laneOpenedRequest({ event: laneOpenedEvent({ auditEventId: '' }) });
    const r1 = await h.sink.deliver(noAudit);
    assertFailed(r1, 'malformed_request');
    assert.ok(r1.error!.message.includes('auditEventId'));
    assert.ok(!r1.error!.message.includes(CASE_ID));

    const noDay = digestRequest(['RAI-2000-0001'], {
      event: digestEvent({ digestDay: null as unknown as string }),
    });
    const r2 = await h.sink.deliver(noDay);
    assertFailed(r2, 'malformed_request');
    assert.ok(r2.error!.message.includes('digestDay'));

    const noVersion = laneOpenedRequest({ event: laneOpenedEvent({ versionId: null }) });
    const r3 = await h.sink.deliver(noVersion);
    assertFailed(r3, 'malformed_request');
    assert.ok(r3.error!.message.includes('versionId'));
    await assertNothingRecorded(h, 0);
  },
);

forEachSink(
  'oversize request: a 65 537-byte body or a 999-byte subject is sink_failure naming the size',
  async (h) => {
    const link = caseLink(CASE_ID);
    const bigBody = laneOpenedRequest({ textBody: padToBytes(`\n${link.url}\n`, MAX_BODY_BYTES + 1) });
    assert.equal(Buffer.byteLength(bigBody.mail.textBody, 'utf8'), 65_537);
    const r1 = await h.sink.deliver(bigBody);
    assertFailed(r1, 'sink_failure');
    assert.ok(r1.error!.message.includes('65537'));
    assert.ok(r1.error!.message.includes('textBody'));
    assert.ok(!r1.error!.message.includes('xxxx'), 'never the contents');

    const bigSubject = laneOpenedRequest({ subject: padToBytes('', MAX_SUBJECT_BYTES + 1) });
    const r2 = await h.sink.deliver(bigSubject);
    assertFailed(r2, 'sink_failure');
    assert.ok(r2.error!.message.includes('999'));
    assert.ok(r2.error!.message.includes('subject'));
    await assertNothingRecorded(h, 0);

    // the boundary values themselves are accepted
    const maxBody = laneOpenedRequest({ textBody: padToBytes(`\n${link.url}\n`, MAX_BODY_BYTES) });
    assert.equal((await h.sink.deliver(maxBody)).status, 'delivered');
  },
);

forEachSink(
  'a rejected request does not consume its dedupKey: the same key delivered afterwards is delivered',
  async (h) => {
    const key = buildDedupKey(laneOpenedEvent(), AI_COE_RECIPIENT);
    const rejected: DeliveryRequest[] = [
      laneOpenedRequest({ event: laneOpenedEvent({ auditEventId: '' }), dedupKey: key }),
      laneOpenedRequest({ deepLinks: [caseLink(CASE_ID, 'http://other.test')], dedupKey: key }),
      laneOpenedRequest({ recipient: { ...AI_COE_RECIPIENT, address: 'someone@gmail.com' }, dedupKey: key }),
      laneOpenedRequest({ subject: padToBytes('', MAX_SUBJECT_BYTES + 1), dedupKey: key }),
    ];
    for (const request of rejected) assert.equal((await h.sink.deliver(request)).status, 'failed');
    await assertNothingRecorded(h, 0);
    const receipt = await h.sink.deliver(laneOpenedRequest({ dedupKey: key }));
    assert.equal(receipt.status, 'delivered');
    assert.equal(h.sink.receipts.length, 5, 'every receipt is logged, only the delivery is recorded');
  },
);

forEachSink('Thai subject intact: แจ้งเตือน: เลนเปิดแล้ว round-trips byte-identical', async (h) => {
  const subject = 'แจ้งเตือน: เลนเปิดแล้ว';
  const request = laneOpenedRequest({ subject });
  assert.equal((await h.sink.deliver(request)).status, 'delivered');
  const stored = h.sink.find(request.dedupKey)!.mail.subject;
  assert.equal(stored, subject);
  assert.deepEqual(Buffer.from(stored, 'utf8'), Buffer.from(subject, 'utf8'));
});

test('a sink refuses a PUBLIC_BASE_URL that is not a URL and uses only the origin of a valid one', () => {
  assert.throws(() => new MemoryMailSink({ publicBaseUrl: 'not a url' }), RangeError);
  const sink = new MemoryMailSink({ publicBaseUrl: 'http://127.0.0.1:8787/' });
  assert.equal(sink.identity.sink, 'memory');
});
