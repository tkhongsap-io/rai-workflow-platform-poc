// The composition root: reads config, refuses to start when config fails closed (exit 78), builds the app and
// listens. W1-00 wires no identity adapter, database or routes; W1-01a adds the adapter's start() before listen and
// mounts the fixture verifier behind the mode switch (W0-03 section 7), which config.ts already gates to
// NODE_ENV=test on a loopback bind (S13, S14); config.ts also refuses a non-loopback bind in local-google (S2,
// W0-02 section 5 HOST row), so `loopback` in process.started is false only in network or production.
// main.ts never migrates (W0-04).

import { ConfigError, EXIT_CONFIG, parseConfig, readEnv } from './config.js';
import { buildApp } from './app.js';
import { startedFields } from './observability/started.js';

async function main(): Promise<void> {
  let config;
  try {
    config = parseConfig(readEnv());
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(JSON.stringify({ event: 'process.refused', reason: err.reason }));
      process.exit(EXIT_CONFIG);
    }
    throw err;
  }
  const { fastify, emitter } = buildApp({ config });
  await fastify.listen({ host: config.host, port: config.port });
  emitter.log('process.started', startedFields(config));
  const stop = (signal: NodeJS.Signals) => {
    emitter.log('process.stopping', { signal });
    void fastify.close().then(() => process.exit(0));
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((err: unknown) => {
  console.error(
    JSON.stringify({ event: 'process.refused', reason: err instanceof Error ? err.name : 'unknown' }),
  );
  process.exit(1);
});
