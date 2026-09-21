// The delivery flow both sinks share (W0-07 sections 4.3, 4.4, 4.7): validate, answer `duplicate` for an accepted
// key, apply a forced failure, then record. The sink is single-attempt and stateless with respect to retry; it
// knows nothing about the workflow, the case, the version's contents or the actor. Imports only @rai/shared and
// node built-ins (W0-07 section 2 rule), never Drizzle, the database, Fastify or the notification module.

import type { DeliveryReceipt, DeliveryRequest, MailSink } from '@rai/shared/mail/types';
import { SUBSTITUTE_MARKER } from '../../substitute-marker.js';
import { ForcedFailure, type MailSinkControl } from './control.js';
import { validateDeliveryRequest } from './validate.js';

export interface MailSinkOptions {
  /** The configured `PUBLIC_BASE_URL`; only its origin is used for the section 4.3 origin check. */
  publicBaseUrl: string | URL;
  /** Clock for `DeliveryReceipt.at`; tests inject a fixed one. */
  now?: () => Date;
}

/** The build check greps for this marker (W0-02 section 1.1); every substitute references it. */
export const MAIL_SINK_SUBSTITUTE_MARKER: string = SUBSTITUTE_MARKER;

export abstract class BaseMailSink implements MailSink, MailSinkControl {
  abstract readonly identity: { sink: 'memory' | 'file'; version: string };

  protected readonly origin: string;
  protected readonly now: () => Date;
  protected readonly accepted = new Set<string>();
  readonly #forced = new ForcedFailure();
  readonly #sent: DeliveryRequest[] = [];
  readonly #receipts: DeliveryReceipt[] = [];

  constructor(options: MailSinkOptions) {
    let base: URL;
    try {
      base = new URL(String(options.publicBaseUrl));
    } catch {
      throw new RangeError('publicBaseUrl');
    }
    this.origin = base.origin;
    this.now = options.now ?? (() => new Date());
  }

  get sent(): ReadonlyArray<DeliveryRequest> {
    return this.#sent;
  }

  get receipts(): ReadonlyArray<DeliveryReceipt> {
    return this.#receipts;
  }

  failNext(count: number, code: 'sink_failure' = 'sink_failure'): void {
    this.#forced.failNext(count, code);
  }

  failWhen(predicate: (req: DeliveryRequest) => boolean): void {
    this.#forced.failWhen(predicate);
  }

  failAlways(on: boolean): void {
    this.#forced.failAlways(on);
  }

  find(dedupKey: string): DeliveryRequest | undefined {
    return this.#sent.find((r) => r.dedupKey === dedupKey);
  }

  reset(): void {
    this.#forced.reset();
    this.#sent.length = 0;
    this.#receipts.length = 0;
    this.accepted.clear();
  }

  /** The W0-10 readiness `mailSink` probe. */
  abstract health(): Promise<'ok' | 'unavailable'>;

  /** Records one delivery and returns the sink's own handle (`sinkMessageId`). Throws on a real sink failure. */
  protected abstract record(request: DeliveryRequest, receipt: DeliveryReceipt): Promise<string>;

  /** Loads state the sink keeps outside the process (the file sink's accepted-key index); no-op by default. */
  protected ready(): Promise<void> {
    return Promise.resolve();
  }

  async deliver(request: DeliveryRequest): Promise<DeliveryReceipt> {
    const at = this.now().toISOString();
    const base = { dedupKey: request.dedupKey, attempt: request.attempt, at };

    const invalid = validateDeliveryRequest(request, this.origin);
    if (invalid !== null)
      return this.#answer({ ...base, status: 'failed', sinkMessageId: null, error: invalid });

    try {
      await this.ready();
    } catch (err) {
      return this.#answer({
        ...base,
        status: 'failed',
        sinkMessageId: null,
        error: { code: 'sink_failure', message: `sink unavailable: ${errorCode(err)}` },
      });
    }

    if (this.accepted.has(request.dedupKey)) {
      return this.#answer({
        ...base,
        status: 'duplicate',
        sinkMessageId: null,
        error: { code: 'duplicate', message: 'dedupKey already delivered by this sink' },
      });
    }

    const forced = this.#forced.take(request);
    if (forced !== null) {
      return this.#answer({
        ...base,
        status: 'failed',
        sinkMessageId: null,
        error: { code: 'sink_failure', message: `forced failure (${forced})` },
      });
    }

    const receipt: DeliveryReceipt = { ...base, status: 'delivered', sinkMessageId: null, error: null };
    try {
      receipt.sinkMessageId = await this.record(request, receipt);
    } catch (err) {
      return this.#answer({
        ...base,
        status: 'failed',
        sinkMessageId: null,
        error: { code: 'sink_failure', message: `sink error: ${errorCode(err)}` }, // the code, never a path or contents
      });
    }
    this.accepted.add(request.dedupKey);
    this.#sent.push(request);
    return this.#answer(receipt);
  }

  #answer(receipt: DeliveryReceipt): DeliveryReceipt {
    this.#receipts.push(receipt);
    return receipt;
  }
}

/** The errno code of a filesystem error (`EACCES`, `ENOSPC`, ...) or `unknown`; never the message, which may name a path. */
function errorCode(err: unknown): string {
  return err instanceof Error && 'code' in err && typeof err.code === 'string' ? err.code : 'unknown';
}
