import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { DeliveryReceipt, DeliveryRequest } from '@rai/shared/mail/types';
import { FileMailSink } from './file.js';
import { MemoryMailSink } from './memory.js';
import { laneOpenedRequest, PUBLIC_BASE_URL } from './support.js';

for (const kind of ['memory', 'file'] as const) {
  for (const failFirst of [false, true]) {
    test(
      `[${kind}] concurrent attempts: ${failFirst ? 'record failure releases retry' : 'one delivery, one duplicate'}`,
      { timeout: 5_000 },
      async (t) => {
        const dir = await mkdtemp(path.join(os.tmpdir(), 'rai-mail-concurrent-'));
        t.after(() => rm(dir, { recursive: true, force: true }));
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        t.after(() => release.resolve());
        const request = laneOpenedRequest();
        let recordCalls = 0;
        const beforeRecord = async (req: DeliveryRequest) => {
          if (req.dedupKey !== request.dedupKey) return;
          recordCalls += 1;
          if (req.attempt === 1) {
            entered.resolve();
            await release.promise;
            if (failFirst) throw Object.assign(new Error('synthetic write failure'), { code: 'EIO' });
          }
        };
        class GatedMemory extends MemoryMailSink {
          protected override async record(req: DeliveryRequest, receipt: DeliveryReceipt): Promise<string> {
            await beforeRecord(req);
            return super.record(req, receipt);
          }
        }
        class GatedFile extends FileMailSink {
          protected override async record(req: DeliveryRequest, receipt: DeliveryReceipt): Promise<string> {
            await beforeRecord(req);
            return super.record(req, receipt);
          }
        }
        const sink =
          kind === 'memory'
            ? new GatedMemory({ publicBaseUrl: PUBLIC_BASE_URL })
            : new GatedFile({ publicBaseUrl: PUBLIC_BASE_URL, dir });
        const first = sink.deliver(request);
        await entered.promise;
        const second = sink.deliver({ ...request, attempt: 2 });
        // A separate key must complete while the first key's record is suspended.
        const other = laneOpenedRequest({
          recipient: { ...request.recipient, address: 'other@rai-desk.example' },
        });
        assert.equal((await sink.deliver(other)).status, 'delivered');
        assert.equal(recordCalls, 1, 'the same-key retry must not enter record before release');
        release.resolve();
        const receipts = await Promise.all([first, second]);
        assert.deepEqual(
          receipts.map((r) => r.status),
          failFirst ? ['failed', 'delivered'] : ['delivered', 'duplicate'],
        );
        if (failFirst) assert.equal(receipts[0].error?.code, 'sink_failure');
        assert.equal(recordCalls, failFirst ? 2 : 1);
        assert.equal(sink.sent.filter((r) => r.dedupKey === request.dedupKey).length, 1);
        assert.equal((await sink.deliver({ ...request, attempt: 3 })).status, 'duplicate');
        if (kind === 'file') {
          const names = (await readdir(dir)).filter((n) => n.endsWith('.json'));
          const files = await Promise.all(
            names.map(
              async (name) =>
                JSON.parse(await readFile(path.join(dir, name), 'utf8')) as { request: DeliveryRequest },
            ),
          );
          const matching = files.filter((f) => f.request.dedupKey === request.dedupKey);
          assert.equal(matching.length, 1);
          assert.equal(matching[0]!.request.attempt, failFirst ? 2 : 1);
        }
      },
    );
  }
}
