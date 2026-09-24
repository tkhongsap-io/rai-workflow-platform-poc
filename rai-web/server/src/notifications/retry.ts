// Pure retry policy: the dispatcher locks the row and commits the returned state.
import type { DeliveryReceipt } from '@rai/shared/mail/types';

export const RETRY_BACKOFF_MS = Object.freeze([1000, 5000, 25000] as const);
export const MAX_DELIVERY_ATTEMPTS = 4;

export interface RetryState {
  status: 'queued' | 'sent' | 'failed';
  /** Completed attempt results committed to the DB, not crash-proof physical invocation count. */
  attempts: number;
  nextAttemptAt: Date | null;
}

export interface DeliveryUpdate extends RetryState {
  lastErrorCode: string | null;
}

/** Undefined means do not invoke the sink. Recheck under the notification row lock. */
export function nextAttempt(state: RetryState, now: Date): number | undefined {
  if (
    state.status !== 'queued' ||
    !Number.isInteger(state.attempts) ||
    state.attempts < 0 ||
    state.attempts >= MAX_DELIVERY_ATTEMPTS ||
    !Number.isFinite(now.getTime())
  )
    return undefined;
  if (state.nextAttemptAt === null) return state.attempts === 0 ? 1 : undefined;
  return state.nextAttemptAt.getTime() <= now.getTime() ? state.attempts + 1 : undefined;
}

/** Call after the result, using failure completion time; no wall clock or database IO here. */
export function deliveryUpdate(
  attempt: number,
  receipt: Pick<DeliveryReceipt, 'status' | 'error'>,
  completedAt: Date,
): DeliveryUpdate {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_DELIVERY_ATTEMPTS) {
    throw new RangeError('attempt');
  }
  if (!Number.isFinite(completedAt.getTime())) throw new RangeError('completedAt');
  switch (receipt.status) {
    case 'delivered':
    case 'duplicate':
      return { status: 'sent', attempts: attempt, nextAttemptAt: null, lastErrorCode: null };
    case 'failed': {
      const delay = RETRY_BACKOFF_MS[attempt - 1];
      const nextAttemptAt = delay === undefined ? null : new Date(completedAt.getTime() + delay);
      if (nextAttemptAt !== null && !Number.isFinite(nextAttemptAt.getTime())) {
        throw new RangeError('nextAttemptAt');
      }
      return {
        status: delay === undefined ? 'failed' : 'queued',
        attempts: attempt,
        nextAttemptAt,
        lastErrorCode: receipt.error?.code ?? 'sink_failure',
      };
    }
  }
}
