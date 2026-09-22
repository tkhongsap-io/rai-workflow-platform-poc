// Guarded test-owned IPC. All outcomes are produced by the real worker/orchestrator, never SQL writes.
import type * as Startup from '../../../server/src/start.js';
import { readEnv, isLoopbackHost } from '../../../server/src/config.js';
import { isJourneyCommand, type JourneyCommand } from './journey-controls.js';
import { lstat, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
const env = readEnv();
if (
  env.NODE_ENV !== 'test' ||
  env.RAI_IDENTITY_MODE !== 'fixture' ||
  !isLoopbackHost(env.HOST ?? '') ||
  !process.send
)
  throw new Error('Synthetic journey requires test fixture loopback IPC');
const sinkDir = env.MAIL_SINK_DIR!;
const parent = await realpath(path.dirname(sinkDir));
if (
  path.dirname(parent) !== (await realpath(tmpdir())) ||
  !path.basename(parent).startsWith('rai-browser-mail-') ||
  path.basename(sinkDir) !== 'mail' ||
  (await lstat(sinkDir)).isSymbolicLink()
)
  throw new Error('Journey sink must be its owned temporary directory');
const backup = path.join(parent, 'mail-fault-backup');
const dbUrl = new URL(env.DATABASE_OPERATOR_URL!);
if (!isLoopbackHost(dbUrl.hostname)) throw new Error('Journey controls require loopback DB');
const built = '../../../server/dist/start.js';
const { startServer } = (await import(built)) as typeof Startup;
const { JourneyQcRunner } = await import('./journey-runner.js');
let caseId: string | undefined;
let offset = 0;
const now = () => new Date(Date.now() + offset);
const runner = new JourneyQcRunner({
  now,
  fixtureCaseIdOf: (v) => (v.caseId === caseId ? 'fx-case-nonvendor' : undefined),
});
const server = await startServer(env, { qcRunner: runner, now });
const db = new pg.Client({ connectionString: dbUrl.href });
await db.connect();
let failed = false;
let stopping = false;
const advancedAttempts = new Set<string>();
async function mailFailure(enabled: boolean) {
  if (enabled === failed) return;
  if (enabled) {
    await rename(sinkDir, backup);
    try {
      await writeFile(sinkDir, 'synthetic sink failure', { flag: 'wx' });
    } catch (error) {
      await rename(backup, sinkDir);
      throw error;
    }
  } else {
    await unlink(sinkDir);
    await rename(backup, sinkDir);
  }
  failed = enabled;
}
async function control(command: JourneyCommand) {
  if (stopping) throw new Error('stopping');
  if (command.command === 'bindCase') {
    if (caseId !== undefined && caseId !== command.caseId) throw new Error('case_already_bound');
    const found = await db.query('SELECT id FROM "case" WHERE id=$1', [command.caseId]);
    if (found.rowCount !== 1) throw new Error('case_missing');
    caseId = command.caseId;
  } else if (command.command === 'mailFailure') await mailFailure(command.enabled);
  else if (command.command === 'submitTimeout') {
    if (!caseId) throw new Error('case_not_bound');
    runner.armSubmitTimeout(undefined); // clear future arm only, not an in-flight run
    if (command.enabled) {
      const result = await db.query<{ draft_version_id: string | null }>(
        'SELECT draft_version_id FROM "case" WHERE id=$1',
        [caseId],
      );
      const versionId = result.rows[0]?.draft_version_id;
      if (!versionId) throw new Error('draft_missing');
      runner.armSubmitTimeout(versionId);
    }
  } else {
    if (!caseId) throw new Error('case_not_bound');
    const advanceKey = `${command.notificationId}:${command.expectedAttempts}`;
    if (advancedAttempts.has(advanceKey)) throw new Error('attempt_already_advanced');
    const result = await db.query<{ attempts: number; status: string; next_attempt_at: Date | null }>(
      'SELECT attempts,status,next_attempt_at FROM notification WHERE id=$1 AND case_id=$2',
      [command.notificationId, caseId],
    );
    const row = result.rows[0];
    if (row?.status !== 'queued' || row.attempts !== command.expectedAttempts || !row.next_attempt_at)
      throw new Error('attempt_not_committed');
    advancedAttempts.add(advanceKey);
    offset += [1000, 5000, 25000][command.expectedAttempts - 1]!;
  }
}
let controls = Promise.resolve();
process.on('message', (message: unknown) => {
  if (!isJourneyCommand(message)) {
    process.send?.({ rejected: 'invalid_command' });
    return;
  }
  controls = controls.then(async () => {
    try {
      await control(message);
      process.send?.({ id: message.id, ok: true });
    } catch {
      process.send?.({ id: message.id, ok: false, error: 'control_refused' });
    }
  });
});
process.on('SIGTERM', () => {
  if (stopping) return;
  stopping = true;
  const timer = setTimeout(() => process.exit(1), 15000);
  timer.unref();
  void (async () => {
    await controls;
    await server.close(); // stop dispatcher/digest/QC before restoring or deleting owned files
    await mailFailure(false);
    await db.end();
    process.exit(0);
  })().catch(() => process.exit(1));
});
process.send({ ready: true });
