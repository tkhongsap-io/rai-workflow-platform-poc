// The composition root: reads config, refuses to start when config fails closed (exit 78), builds the app and
// listens. W1-00 wires no identity adapter, database or routes; W1-01a adds the adapter's start() before listen and
// mounts the fixture verifier behind the mode switch (W0-03 section 7), which config.ts already gates to
// NODE_ENV=test on a loopback bind (S13, S14). main.ts never migrates (W0-04).

import { ConfigError, EXIT_CONFIG, parseConfig, readEnv } from './config.js';
import { buildApp } from './app.js';

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
  const address = await fastify.listen({ host: config.host, port: config.port });
  emitter.log('process.started', {
    identityMode: config.identity.mode,
    loopback: /^https?:\/\/(127\.0\.0\.1|\[::1\]|localhost)[:/]/.test(address),
    schemaVersion: 'unknown-until-W3-07',
    commit: config.buildCommit,
  });
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
