// W0-10 section 2: one correlation ID per unit of work, minted by the server (Fastify genReqId → request.id) and
// carried in an AsyncLocalStorage so repositories and services never take it as a parameter by hand. A client-
// supplied X-Correlation-Id is never read.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export type CorrelationId = string; // UUID v4, server-minted, opaque

export interface RequestContext {
  correlationId: CorrelationId;
  startedAt: number; // performance.now() for durationMs
  route?: string; // Fastify route pattern, never the raw URL
  actor?: { subjectId: string; roles: ReadonlyArray<string> }; // opaque subject id only; never email or display name
}

/** Process-level id for lines emitted outside a request or job (W0-10 section 2.2). */
export const PROCESS_ID: string = randomUUID();

const storage = new AsyncLocalStorage<RequestContext>();

export class NoContextError extends Error {
  readonly code = 'OBS_NO_CONTEXT';
  constructor() {
    super('OBS_NO_CONTEXT: no request or job context is active');
    this.name = 'NoContextError';
  }
}

export function mintCorrelationId(): CorrelationId {
  return randomUUID();
}

/** Throws OBS_NO_CONTEXT outside a request or job. */
export function currentContext(): RequestContext {
  const ctx = storage.getStore();
  if (ctx === undefined) throw new NoContextError();
  return ctx;
}

export function maybeContext(): RequestContext | undefined {
  return storage.getStore();
}

export function runWithContext<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}
