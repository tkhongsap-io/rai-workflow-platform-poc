// Test-owned IPC; no runtime env selector or HTTP control endpoint. Uses the built startup and SPA.
import type * as Startup from '../../../server/src/start.js';
import { readEnv, isLoopbackHost } from '../../../server/src/config.js';
const env = readEnv();
if (
  env.NODE_ENV !== 'test' ||
  env.RAI_IDENTITY_MODE !== 'fixture' ||
  !isLoopbackHost(env.HOST ?? '') ||
  !process.send
) {
  throw new Error('Synthetic journey requires test fixture loopback IPC');
}
// Dynamic built import keeps the guard before application startup/import side effects.
const built = '../../../server/dist/start.js';
const { startServer } = (await import(built)) as typeof Startup;
const { ScriptedQcRunner } = await import('@rai/fixtures/substitutes/qc/index');
let caseId: string | undefined;
const runner = new ScriptedQcRunner({
  fixtureCaseIdOf: (v) => (v.caseId === caseId ? 'fx-case-nonvendor' : undefined),
});
const server = await startServer(env, { qcRunner: runner });
process.on('message', (message: unknown) => {
  if (
    typeof message !== 'object' ||
    message === null ||
    !('caseId' in message) ||
    typeof message.caseId !== 'string' ||
    !/^[0-9a-f-]{36}$/.test(message.caseId)
  )
    return;
  if (caseId !== undefined && caseId !== message.caseId) return;
  caseId = message.caseId;
  process.send?.({ bound: caseId });
});
let stopping = false;
process.on('SIGTERM', () => {
  if (stopping) return;
  stopping = true;
  const timer = setTimeout(() => process.exit(1), 15000);
  timer.unref();
  void server.close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
});
process.send({ ready: true });
