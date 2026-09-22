// Minimal W3-03a wiring; dynamic local-sink import keeps fixture code out of server/dist.
import type { FastifyInstance } from 'fastify';
import type { MailSink } from '@rai/shared/mail/types';
import type { AppConfig } from '../config.js';
import type { Notifications } from './service.js';
import type { Drain } from '../shutdown.js';
import type { Emitter } from '../observability/log.js';

export async function loadMailSink(
  config: Pick<AppConfig, 'mail' | 'publicBaseUrl' | 'nodeEnv'>,
): Promise<MailSink | undefined> {
  if (config.nodeEnv === 'production') return undefined;
  const specifier = '@rai/fixtures/substitutes/mail-sink/index';
  const module = (await import(specifier)) as {
    MemoryMailSink: new (options: { publicBaseUrl: URL }) => MailSink;
    FileMailSink: new (options: { publicBaseUrl: URL; dir: string }) => MailSink;
  };
  return config.mail.mode === 'sink-memory'
    ? new module.MemoryMailSink({ publicBaseUrl: config.publicBaseUrl })
    : new module.FileMailSink({ publicBaseUrl: config.publicBaseUrl, dir: config.mail.sinkDir });
}

export function registerNotifications(
  app: FastifyInstance,
  notifications: Notifications,
  emitter: Emitter,
  drain: Drain,
): void {
  const active = new Set<Promise<void>>();
  function run(correlationId?: string): Promise<void> {
    if (drain.signal.aborted) return Promise.resolve();
    const task = notifications.deliverPending(correlationId, drain.signal).catch(() => {
      if (drain.signal.aborted) return;
      emitter.log('error.captured', { category: 'dependency', code: 'mail_delivery_failed' });
    });
    active.add(task);
    drain.track(task);
    void task.finally(() => active.delete(task));
    return task;
  }
  app.addHook('onReady', () => run());
  // After the committing handler and HTTP response; sink failure cannot undo either.
  app.addHook('onResponse', async (request, reply) => {
    if (request.method === 'POST' && reply.statusCode < 400) await run(request.id);
  });
  app.addHook('onClose', async () => {
    await Promise.all(active);
  });
}
