// OBS15: only integration factory entry point; no application or process-wide logger mutation.
import { after, afterEach } from 'node:test';
import { buildApp as realBuildApp, type App, type AppDeps } from '@rai/server/app';
import { createAuditedLogStream } from './log-capture.js';

const observed: { app?: App; audit: ReturnType<typeof createAuditedLogStream> }[] = [];

export function buildApp(deps: AppDeps): App {
  const entry: (typeof observed)[number] = { audit: createAuditedLogStream(deps.logStream) };
  observed.push(entry); // retain even initialization logs if construction throws
  entry.app = realBuildApp({
    ...deps,
    config: { ...deps.config, log: { ...deps.config.log, level: 'info', pretty: false } },
    logStream: entry.audit.stream,
  });
  return entry.app;
}

afterEach(async () => {
  // Do not close apps that suites intentionally reuse. Never clear earlier evidence.
  for (const { audit } of observed) await audit.settled();
});
after(async () => {
  const results = await Promise.allSettled(
    observed.map(async ({ app, audit }) => {
      try {
        await app?.drain.close();
      } finally {
        await audit.settled();
      }
    }),
  );
  // Audit streams stay live even after this hook: a late leak sets the failure exit status.
  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw new Error('OBS15 final drain or log audit failed');
});
