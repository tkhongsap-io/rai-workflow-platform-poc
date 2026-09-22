// W0-07 section 4.7: the control API both sinks expose to tests and to the W3-04 rehearsal. Instance only, never
// reachable over HTTP. `failNext` / `failAlways` are the names W0-10 section 8.1 expects. Forced failure is a
// control-API call, not a configuration key (W0-07 section 6).

import type { DeliveryReceipt, DeliveryRequest } from '@rai/shared/mail/types';

export interface MailSinkControl {
  /** The next `count` deliveries return `failed:sink_failure`. */
  failNext(count: number, code?: 'sink_failure'): void;
  /** Every delivery for which the predicate is true returns `failed:sink_failure`, until `reset()` or a new predicate. */
  failWhen(predicate: (req: DeliveryRequest) => boolean): void;
  /** While on, every delivery returns `failed:sink_failure` (forces D06 exhaustion). */
  failAlways(on: boolean): void;
  /** The delivered request for an accepted dedup key, if this process delivered it. */
  find(dedupKey: string): DeliveryRequest | undefined;
  /** Requests that were delivered (never a rejected, forced-failed or duplicate one). */
  readonly sent: ReadonlyArray<DeliveryRequest>;
  /** Every receipt this instance returned, in order: the attempt log W0-10 section 8.1 asks for. */
  readonly receipts: ReadonlyArray<DeliveryReceipt>;
  /** Clears forced failures, `sent`, `receipts` and the accepted-key index of this instance. */
  reset(): void;
}

export type ForcedFailureReason = 'failAlways' | 'failNext' | 'failWhen';

/** The forced-failure state behind `failNext`, `failWhen` and `failAlways`; shared by both sinks. */
export class ForcedFailure {
  #next = 0;
  #always = false;
  #predicate: ((req: DeliveryRequest) => boolean) | null = null;

  failNext(count: number, _code: 'sink_failure' = 'sink_failure'): void {
    if (!Number.isInteger(count) || count < 0) throw new RangeError('count');
    this.#next = count;
  }

  failWhen(predicate: (req: DeliveryRequest) => boolean): void {
    this.#predicate = predicate;
  }

  failAlways(on: boolean): void {
    this.#always = on;
  }

  reset(): void {
    this.#next = 0;
    this.#always = false;
    this.#predicate = null;
  }

  /** Consumes one forced failure when one applies to this request; `failNext` counts down only when it fires. */
  take(request: DeliveryRequest): ForcedFailureReason | null {
    if (this.#always) return 'failAlways';
    if (this.#next > 0) {
      this.#next -= 1;
      return 'failNext';
    }
    if (this.#predicate !== null && this.#predicate(request)) return 'failWhen';
    return null;
  }
}
