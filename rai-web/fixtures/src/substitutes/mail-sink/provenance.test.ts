import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DeliveryRequest } from '@rai/shared/mail/types';
import { FileMailSink } from './file.js';
import { MemoryMailSink } from './memory.js';
import {
  digestEvent,
  digestRequest,
  laneOpenedRequest,
  laneOpenedEvent,
  CASE_ID,
  PUBLIC_BASE_URL,
} from './support.js';

for (const kind of ['memory', 'file'] as const) {
  test(`${kind}: real digest days, per-day dedup and ordinary audit regressions`, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'rai-digest-contract-'));
    try {
      const sink =
        kind === 'file'
          ? new FileMailSink({ dir, publicBaseUrl: PUBLIC_BASE_URL })
          : new MemoryMailSink({ publicBaseUrl: PUBLIC_BASE_URL });
      for (const day of ['2024-02-29', '2026-09-22', '2026-09-23', '2000-02-29']) {
        const request = digestRequest([CASE_ID], { event: digestEvent({ digestDay: day }) });
        assert.equal((await sink.deliver(request)).status, 'delivered', day);
        const again = structuredClone(request);
        if (again.event.kind === 'sla_breach_digest')
          again.event.provenance.jobRunId = '0192b3c4-0000-7000-8000-000000000402';
        assert.equal((await sink.deliver(again)).status, 'duplicate', 'new run cannot bypass day identity');
      }
      for (const eventKind of ['lane_opened', 'sent_back', 'ready_for_launch'] as const) {
        assert.equal(
          (
            await sink.deliver(
              laneOpenedRequest({
                event: laneOpenedEvent({
                  kind: eventKind,
                  lane: eventKind === 'ready_for_launch' ? null : 'dpo',
                }),
              }),
            )
          ).status,
          'delivered',
        );
      }
      if (kind === 'file') {
        const texts = await Promise.all(
          (await readdir(dir))
            .filter((n) => n.endsWith('.txt'))
            .map((n) => readFile(path.join(dir, n), 'utf8')),
        );
        const digest = texts.filter((t) => t.includes('X-RAI-Event: sla_breach_digest'));
        assert.equal(digest.length, 4);
        for (const text of digest) {
          assert.match(text, /X-RAI-Job-Run-Id:/);
          assert.match(text, /X-RAI-Digest-Day:/);
          assert.doesNotMatch(text, /X-RAI-Audit-Event-Id:|undefined/);
        }
        const restarted = new FileMailSink({ dir, publicBaseUrl: PUBLIC_BASE_URL });
        assert.equal(
          (
            await restarted.deliver(
              digestRequest([CASE_ID], { event: digestEvent({ digestDay: '2026-09-22' }) }),
            )
          ).status,
          'duplicate',
        );
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test(`${kind}: invalid/cross-variant provenance is rejected before recording`, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'rai-digest-invalid-'));
    try {
      const sink =
        kind === 'file'
          ? new FileMailSink({ dir, publicBaseUrl: PUBLIC_BASE_URL })
          : new MemoryMailSink({ publicBaseUrl: PUBLIC_BASE_URL });
      const valid = digestRequest([CASE_ID]);
      const event = digestEvent();
      const badEvents: unknown[] = [
        { ...event, provenance: undefined },
        { ...event, provenance: null },
        { ...event, auditEventId: 'invented-audit' },
        ...[
          '2026-02-29',
          '1900-02-29',
          '2026-04-31',
          '2026-13-01',
          '2026-00-01',
          '0000-01-01',
          '2026-9-22',
        ].map((day) => ({ ...event, digestDay: day, provenance: { ...event.provenance, digestDay: day } })),
        ...[
          { kind: 'human' },
          { jobRunId: 'fake' },
          { correlationId: 'fake' },
          { digestDay: '2026-09-22' },
          { correlationId: '0192b3c4-0000-7000-8000-000000000403' },
          { extra: true },
        ].map((change) => ({ ...event, provenance: { ...event.provenance, ...change } })),
        { ...event, versionNumber: 1 },
        { ...event, lane: 'dpo' },
      ];
      for (const bad of badEvents) {
        const result = await sink.deliver({ ...valid, event: bad } as DeliveryRequest);
        assert.equal(result.status, 'failed');
        assert.equal(result.error?.code, 'malformed_request');
      }
      for (const eventKind of ['lane_opened', 'sent_back', 'ready_for_launch'] as const) {
        const ordinary = laneOpenedRequest({
          event: laneOpenedEvent({ kind: eventKind, lane: eventKind === 'ready_for_launch' ? null : 'dpo' }),
        });
        for (const change of [
          { auditEventId: undefined },
          { auditEventId: '' },
          { provenance: event.provenance },
        ]) {
          assert.equal(
            (
              await sink.deliver({
                ...ordinary,
                event: { ...ordinary.event, ...change },
              } as unknown as DeliveryRequest)
            ).error?.code,
            'malformed_request',
          );
        }
      }
      assert.equal(sink.sent.length, 0);
      assert.equal((await readdir(dir)).length, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
