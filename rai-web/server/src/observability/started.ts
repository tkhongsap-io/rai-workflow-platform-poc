// The W0-10 `process.started` fields (observability-contract.md section 3.3). `loopback` reports the configured
// bind host (W0-02 `HOST`), not the string `fastify.listen()` returns: that string is only the first listening
// address, so a `0.0.0.0` bind would print an interface address and be misreported as loopback. Pure so the field
// can be asserted without a listen; main.ts calls it once after listen succeeds.

import { isLoopbackHost, type AppConfig } from '../config.js';
import type { EventFields } from './log.js';

export function startedFields(
  config: Pick<AppConfig, 'host' | 'identity' | 'buildCommit'>,
): EventFields<'process.started'> {
  return {
    identityMode: config.identity.mode,
    loopback: isLoopbackHost(config.host),
    schemaVersion: 'unknown-until-W3-07',
    commit: config.buildCommit,
  };
}
