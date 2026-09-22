// W0-07 section 4.7 `FileMailSink` (`MAIL_MODE=sink-file`, the `.env.example` default so a person can read what
// would have been sent). One JSON file per delivery attempt with the full request and receipt, and one `.txt`
// beside it with the rendered subject and body. File names are `${sha256(dedupKey).slice(0, 16)}-${attempt}`:
// the dedup key contains the recipient address (personal data under W0-10), so it is hashed before it becomes a
// name. A rejected, forced-failed or duplicate request writes nothing. The accepted-key index is rebuilt from the
// directory on first use, so `duplicate` survives a process restart.

import { createHash } from 'node:crypto';
import { access, constants, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DeliveryReceipt, DeliveryRequest } from '@rai/shared/mail/types';
import { BaseMailSink, type MailSinkOptions } from './base.js';

export interface FileMailSinkOptions extends MailSinkOptions {
  /** `MAIL_SINK_DIR` (W0-02 section 5; default `./.local/mail`, git-ignored). Created on first use if absent. */
  dir: string;
}

/** The on-disk shape of one `<hash>-<attempt>.json`. */
export interface MailSinkFile {
  request: DeliveryRequest;
  receipt: DeliveryReceipt;
}

export function mailFileStem(dedupKey: string, attempt: number): string {
  return `${createHash('sha256').update(dedupKey, 'utf8').digest('hex').slice(0, 16)}-${attempt}`;
}

export class FileMailSink extends BaseMailSink {
  readonly identity = { sink: 'file', version: 'w1-11' } as const;
  readonly dir: string;
  #loaded: Promise<void> | null = null;

  constructor(options: FileMailSinkOptions) {
    super(options);
    this.dir = path.resolve(options.dir);
  }

  /** Rebuilds the accepted-key index from the directory listing (W0-07 section 4.7). */
  protected override ready(): Promise<void> {
    this.#loaded ??= this.#load().catch((err: unknown) => {
      this.#loaded = null; // retried on the next delivery once the directory is writable
      throw err;
    });
    return this.#loaded;
  }

  async #load(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    for (const name of await readdir(this.dir)) {
      if (!/^[0-9a-f]{16}-\d+\.json$/.test(name)) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(path.join(this.dir, name), 'utf8'));
      } catch {
        continue; // a half-written or foreign file marks nothing accepted
      }
      const file = parsed as Partial<MailSinkFile> | null;
      if (
        file !== null &&
        typeof file === 'object' &&
        file.receipt?.status === 'delivered' &&
        typeof file.request?.dedupKey === 'string'
      ) {
        this.accepted.add(file.request.dedupKey);
      }
    }
  }

  override reset(): void {
    super.reset();
    this.#loaded = null; // the next delivery re-reads the directory; files are never deleted by the sink
  }

  async health(): Promise<'ok' | 'unavailable'> {
    try {
      await mkdir(this.dir, { recursive: true });
      await access(this.dir, constants.W_OK);
      return 'ok';
    } catch {
      return 'unavailable';
    }
  }

  protected async record(request: DeliveryRequest, receipt: DeliveryReceipt): Promise<string> {
    const stem = mailFileStem(request.dedupKey, request.attempt);
    const jsonName = `${stem}.json`;
    const file: MailSinkFile = { request, receipt: { ...receipt, sinkMessageId: jsonName } };
    await this.#writeAtomic(`${stem}.txt`, renderText(request));
    await this.#writeAtomic(jsonName, `${JSON.stringify(file, null, 2)}\n`);
    return jsonName;
  }

  async #writeAtomic(name: string, contents: string): Promise<void> {
    const target = path.join(this.dir, name);
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, contents, { encoding: 'utf8', flag: 'wx' });
    await rename(tmp, target);
  }
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
    `X-RAI-Audit-Event-Id: ${event.auditEventId}`,
    `X-RAI-Attempt: ${request.attempt}`,
    'X-RAI-Sink: file (substitute; nothing was sent)',
  ];
  return `${header.join('\n')}\n\n${mail.textBody}\n`;
}
