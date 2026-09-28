// W7-07 (W7 plan section 5.3, register row "W7 delegated rulings (provisional)" W7-D11 option A): the in-product mail
// file drop for `MAIL_MODE=sink-file` outside `fixture` mode. It writes what a transport would have sent as files a
// person can read, and sends nothing: no SMTP, no HTTP mail API, no network module (the fixtures
// `no-external-mail.test.ts` walks this file). Step for step it behaves as the fixture `FileMailSink` (W0-07 sections
// 4.3, 4.4, 4.7): validate, rebuild the accepted-key index from the directory on first use, answer `duplicate` for an
// accepted key (also after a restart), write `<mailFileStem(dedupKey, attempt)>.txt` then `.json` (`{ request,
// receipt }`) atomically, serialized per key. It has no forced-failure control and no substitute marker, and imports
// nothing from `@rai/fixtures`, so it is part of the production build (`check:substitute-absent`). The synthetic-address
// rule inside `validateDeliveryRequest` (W0-07 section 4.6) stays in force; relaxing it is D08-gated.

import { access, constants, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mailFileStem } from '@rai/shared/mail/file-stem';
import type { DeliveryReceipt, DeliveryRequest, MailSink } from '@rai/shared/mail/types';
import { validateDeliveryRequest } from '@rai/shared/mail/validate';

export interface FileDropOptions {
  /** `MAIL_SINK_DIR`; created 0700 on first use when absent. */
  dir: string;
  /** The configured `PUBLIC_BASE_URL`; only its origin is used for the W0-07 section 4.3 origin check. */
  publicBaseUrl: string | URL;
  /** Clock for `DeliveryReceipt.at`; tests inject a fixed one. */
  now?: () => Date;
}

export type FileDropMailSink = MailSink & {
  readonly identity: { sink: 'file'; version: 'w7-07' };
  /** The W0-10 readiness `mailSink` probe: the directory exists (created on demand) and is writable. */
  health(): Promise<'ok' | 'unavailable'>;
};

/** A delivery file name: `<16 hex>-<attempt>.json`, as `mailFileStem` builds it. */
const DELIVERY_FILE = /^[0-9a-f]{16}-\d+\.json$/;

export function createFileDropMailSink(options: FileDropOptions): FileDropMailSink {
  let origin: string;
  try {
    origin = new URL(String(options.publicBaseUrl)).origin;
  } catch {
    throw new RangeError('publicBaseUrl');
  }
  const dir = path.resolve(options.dir);
  const now = options.now ?? (() => new Date());
  const accepted = new Set<string>();
  const pending = new Map<string, Promise<void>>();
  let loaded: Promise<void> | null = null;

  async function load(): Promise<void> {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    for (const name of await readdir(dir)) {
      if (!DELIVERY_FILE.test(name)) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(path.join(dir, name), 'utf8'));
      } catch {
        continue; // a half-written or foreign file marks nothing accepted
      }
      const file = parsed as { request?: { dedupKey?: unknown }; receipt?: { status?: unknown } } | null;
      if (
        file !== null &&
        typeof file === 'object' &&
        file.receipt?.status === 'delivered' &&
        typeof file.request?.dedupKey === 'string'
      )
        accepted.add(file.request.dedupKey);
    }
  }

  function ready(): Promise<void> {
    loaded ??= load().catch((err: unknown) => {
      loaded = null; // retried on the next delivery once the directory is usable
      throw err;
    });
    return loaded;
  }

  async function writeAtomic(name: string, contents: string): Promise<void> {
    const target = path.join(dir, name);
    const tmp = `${target}.${process.pid}.tmp`;
    try {
      await writeFile(tmp, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      await rename(tmp, target);
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
  }

  async function attempt(request: DeliveryRequest): Promise<DeliveryReceipt> {
    const base = { dedupKey: request.dedupKey, attempt: request.attempt, at: now().toISOString() };
    const invalid = validateDeliveryRequest(request, origin);
    if (invalid !== null) return { ...base, status: 'failed', sinkMessageId: null, error: invalid };
    try {
      await ready();
    } catch (err) {
      return {
        ...base,
        status: 'failed',
        sinkMessageId: null,
        error: { code: 'sink_failure', message: `sink unavailable: ${errorCode(err)}` },
      };
    }
    if (accepted.has(request.dedupKey))
      return {
        ...base,
        status: 'duplicate',
        sinkMessageId: null,
        error: { code: 'duplicate', message: 'dedupKey already delivered by this sink' },
      };
    const stem = mailFileStem(request.dedupKey, request.attempt);
    const jsonName = `${stem}.json`;
    const receipt: DeliveryReceipt = { ...base, status: 'delivered', sinkMessageId: jsonName, error: null };
    try {
      await writeAtomic(`${stem}.txt`, renderText(request));
      await writeAtomic(jsonName, `${JSON.stringify({ request, receipt }, null, 2)}\n`);
    } catch (err) {
      return {
        ...base,
        status: 'failed',
        sinkMessageId: null,
        error: { code: 'sink_failure', message: `sink error: ${errorCode(err)}` }, // never a path or contents
      };
    }
    accepted.add(request.dedupKey);
    return receipt;
  }

  return {
    identity: { sink: 'file', version: 'w7-07' },

    async deliver(request) {
      // Serialized per dedupKey, as in the fixtures' base sink: a second attempt waits for the first to record.
      const key = request.dedupKey;
      const previous = pending.get(key);
      let release!: () => void;
      const mine = new Promise<void>((resolve) => {
        release = resolve;
      });
      pending.set(key, mine);
      try {
        await previous;
        return await attempt(request);
      } finally {
        release();
        if (pending.get(key) === mine) pending.delete(key);
      }
    },

    async health() {
      try {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        await access(dir, constants.W_OK);
        return 'ok';
      } catch {
        return 'unavailable';
      }
    },
  };
}

/** The human-readable copy: what a transport would have sent, plus the IDs that tie it to the audit trail. */
function renderText(request: DeliveryRequest): string {
  const { event, recipient, mail } = request;
  const header = [
    `To: ${recipient.address}`,
    `Subject: ${mail.subject}`,
    `X-RAI-Template: ${mail.templateKey}`,
    `X-RAI-Locale: ${recipient.locale}`,
    `X-RAI-Event: ${event.kind}`,
    `X-RAI-Correlation-Id: ${event.correlationId}`,
    ...(event.kind === 'sla_breach_digest'
      ? [`X-RAI-Job-Run-Id: ${event.provenance.jobRunId}`, `X-RAI-Digest-Day: ${event.digestDay}`]
      : [`X-RAI-Audit-Event-Id: ${event.auditEventId}`]),
    `X-RAI-Attempt: ${request.attempt}`,
    'X-RAI-Sink: file (in-product drop; nothing was sent)',
  ];
  return `${header.join('\n')}\n\n${mail.textBody}\n`;
}

/** The errno code of a filesystem error (`EACCES`, `ENOSPC`, ...) or `unknown`; never the message, which may name a path. */
function errorCode(err: unknown): string {
  return err instanceof Error && 'code' in err && typeof err.code === 'string' ? err.code : 'unknown';
}
