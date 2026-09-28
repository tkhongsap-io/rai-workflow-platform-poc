// W7-07 (W7 plan section 5.3): parity between the server's in-product file drop and this package's FileMailSink. For
// one request each writes the same two file names (from the shared `mailFileStem`) and a JSON file of the same
// `MailSinkFile` shape with the same request and receipt; each directory's accepted keys are honoured by the other
// after a restart. The fixtures validator and `mailFileStem` are re-exports of the @rai/shared modules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as sharedStem from '@rai/shared/mail/file-stem';
import * as sharedValidate from '@rai/shared/mail/validate';
import { createFileDropMailSink } from '@rai/server/notifications/file-drop';
import { FileMailSink, mailFileStem, type MailSinkFile } from './file.js';
import * as fixturesValidate from './validate.js';
import { AI_COE_RECIPIENT, digestRequest, laneOpenedRequest, PUBLIC_BASE_URL } from './support.js';

const FIXED_NOW = () => new Date('2026-09-28T04:00:00.000Z');

async function withDirs(body: (drop: string, file: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rai-w7-07-parity-'));
  try {
    await body(path.join(root, 'drop'), path.join(root, 'file'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('W7-07: the fixtures validator and mailFileStem are the @rai/shared ones', () => {
  assert.equal(mailFileStem, sharedStem.mailFileStem);
  assert.equal(fixturesValidate.validateDeliveryRequest, sharedValidate.validateDeliveryRequest);
  assert.equal(fixturesValidate.isSyntheticAddress, sharedValidate.isSyntheticAddress);
  assert.equal(fixturesValidate.CANONICAL_ROUTE_PATTERNS, sharedValidate.CANONICAL_ROUTE_PATTERNS);
  assert.equal(fixturesValidate.MAX_SUBJECT_BYTES, sharedValidate.MAX_SUBJECT_BYTES);
  assert.equal(fixturesValidate.MAX_BODY_BYTES, sharedValidate.MAX_BODY_BYTES);
});

for (const [name, request] of [
  ['lane_opened', laneOpenedRequest({ attempt: 2 })],
  ['sla_breach_digest', digestRequest(['0192b3c4-0000-7000-8000-000000000111'], { withQueueLink: true })],
] as const) {
  test(`W7-07 parity (${name}): same file names, same MailSinkFile JSON, same receipt`, () =>
    withDirs(async (dropDir, fileDir) => {
      const drop = createFileDropMailSink({ dir: dropDir, publicBaseUrl: PUBLIC_BASE_URL, now: FIXED_NOW });
      const file = new FileMailSink({ dir: fileDir, publicBaseUrl: PUBLIC_BASE_URL, now: FIXED_NOW });
      const dropReceipt = await drop.deliver(request);
      const fileReceipt = await file.deliver(request);
      assert.equal(dropReceipt.status, 'delivered', dropReceipt.error?.message);
      assert.deepEqual(dropReceipt, fileReceipt);
      const names = (await readdir(dropDir)).sort();
      assert.deepEqual(names, (await readdir(fileDir)).sort());
      const stem = mailFileStem(request.dedupKey, request.attempt);
      assert.deepEqual(names, [`${stem}.json`, `${stem}.txt`]);
      const dropFile = JSON.parse(await readFile(path.join(dropDir, `${stem}.json`), 'utf8')) as MailSinkFile;
      const fileFile = JSON.parse(await readFile(path.join(fileDir, `${stem}.json`), 'utf8')) as MailSinkFile;
      assert.deepEqual(Object.keys(dropFile).sort(), ['receipt', 'request']);
      assert.deepEqual(dropFile, fileFile);
      // The text copies differ only in the X-RAI-Sink line.
      const strip = (t: string) => t.replace(/^X-RAI-Sink: .*$/m, 'X-RAI-Sink: -');
      assert.equal(
        strip(await readFile(path.join(dropDir, `${stem}.txt`), 'utf8')),
        strip(await readFile(path.join(fileDir, `${stem}.txt`), 'utf8')),
      );
    }));
}

test('W7-07 parity: a FileMailSink directory is read by the drop after a restart (and the reverse): duplicate', () =>
  withDirs(async (dir) => {
    const request = laneOpenedRequest();
    const other = laneOpenedRequest({ recipient: { ...AI_COE_RECIPIENT, address: 'dpo@rai-desk.example' } });
    assert.equal(
      (await new FileMailSink({ dir, publicBaseUrl: PUBLIC_BASE_URL }).deliver(request)).status,
      'delivered',
    );
    const drop = createFileDropMailSink({ dir, publicBaseUrl: PUBLIC_BASE_URL });
    assert.equal((await drop.deliver({ ...request, attempt: 2 })).status, 'duplicate');
    assert.equal((await drop.deliver(other)).status, 'delivered');
    const file = new FileMailSink({ dir, publicBaseUrl: PUBLIC_BASE_URL });
    assert.equal((await file.deliver({ ...other, attempt: 2 })).status, 'duplicate');
  }));
