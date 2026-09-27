// W7-01 (W7 plan section 2 `RAI_PG_TOOLS`, section 3.1; W7-D5): runs pg_dump and pg_restore for the operator
// commands, either from PATH (`path`) or inside the Postgres container (`docker:<container>`,
// `docker-compose:<project>`), so the tools always match a server the team runs in a container without a host
// install. Never a Node re-implementation of pg_dump (W7-D5 option C).
//
// Secrets: the password reaches the child only as PGPASSWORD in its environment. `docker exec -e PGPASSWORD`
// names the variable and docker forwards its value from its own environment, so no argv element (visible in `ps`)
// ever carries the password or the URL. Output streams over stdout into the host file and input over stdin, so no
// container filesystem path is used. Errors name the tool and its exit status, never argv or stderr.

import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { once } from 'node:events';
import type { BackupConfig, PgToolsMode } from '../config.js';

export class PgToolsError extends Error {
  constructor(
    readonly reason:
      | 'pg_tools_failed'
      | 'pg_tools_unavailable'
      | 'pg_tools_container_not_found'
      | 'pg_tools_version_unreadable'
      | 'invalid_database_url',
  ) {
    super(reason);
    this.name = 'PgToolsError';
  }
}

/** A Postgres connection taken apart; the password never leaves this object except as PGPASSWORD. */
export interface PgConnection {
  host: string;
  port: number;
  user: string;
  password: string | undefined;
  database: string;
}

export type PgConnectionTarget = Omit<PgConnection, 'password'>;

export function connectionFromUrl(value: string): PgConnection {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PgToolsError('invalid_database_url');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (database === '' || url.username === '') throw new PgToolsError('invalid_database_url');
  return {
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port: url.port === '' ? 5432 : Number(url.port),
    user: decodeURIComponent(url.username),
    password: url.password === '' ? undefined : decodeURIComponent(url.password),
    database,
  };
}

/**
 * Where the tool connects. In `path` mode, the URL's host and port as given. In the docker modes the tool runs
 * inside the Postgres container, where the host-mapped port does not exist: host 127.0.0.1 and the container port,
 * keeping user and database.
 */
export function toolTarget(mode: PgToolsMode, conn: PgConnection, containerPort: number): PgConnectionTarget {
  const { user, database } = conn;
  if (mode.kind === 'path') return { host: conn.host, port: conn.port, user, database };
  return { host: '127.0.0.1', port: containerPort, user, database };
}

/** One child process: the command, its argv and the variables added to the inherited environment. */
export interface Invocation {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** Where the child's stdout goes (a new file, else captured) and where its stdin comes from. */
export interface ToolIo {
  stdoutTo?: string;
  stdinFrom?: string;
}

export type ToolRunner = (invocation: Invocation, io: ToolIo) => Promise<{ stdout: string }>;

export interface PgTools {
  /** pg_dump against `conn` with `args`; stdout is written to `outPath` (created exclusively, mode 0600). */
  dump(conn: PgConnection, args: readonly string[], outPath: string): Promise<void>;
  /** pg_restore with `args`, reading the archive from `inPath` over stdin; no connection flags when `conn` is null. */
  restore(conn: PgConnection | null, args: readonly string[], inPath: string): Promise<{ stdout: string }>;
  /** The major version of pg_dump where it runs. */
  version(): Promise<number>;
}

export function parseToolMajor(output: string): number {
  const match = /\(PostgreSQL\)\s+(\d+)/.exec(output);
  if (match === null) throw new PgToolsError('pg_tools_version_unreadable');
  return Number(match[1]);
}

function connectionArgs(target: PgConnectionTarget): string[] {
  return [
    '--host',
    target.host,
    '--port',
    String(target.port),
    '--username',
    target.user,
    '--dbname',
    target.database,
    '--no-password', // never prompt: PGPASSWORD or nothing
  ];
}

/** Spawns the invocation; the child inherits this process's environment plus `invocation.env`. */
export const spawnTool: ToolRunner = async (invocation, io) => {
  const child = spawn(invocation.command, invocation.args, {
    env: { ...process.env, ...invocation.env },
    stdio: [io.stdinFrom === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  });
  const spawned = new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', () => reject(new PgToolsError('pg_tools_unavailable')));
  });
  const closed = once(child, 'close') as Promise<[number | null, NodeJS.Signals | null]>;
  closed.catch(() => undefined); // awaited below; a spawn failure is reported through `spawned`
  child.stderr!.resume(); // drained, never reported: it may name objects or hosts
  let stdout = '';
  let written: Promise<void> = Promise.resolve();
  if (io.stdoutTo !== undefined) {
    const file = createWriteStream(io.stdoutTo, { flags: 'wx', mode: 0o600 });
    child.stdout!.pipe(file);
    written = new Promise((resolve, reject) => {
      file.once('finish', resolve);
      file.once('error', (err) => {
        child.kill('SIGTERM'); // nothing reads its stdout any more
        reject(err);
      });
    });
    written.catch(() => undefined); // awaited below, after the child closes
  } else {
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => (stdout += chunk));
  }
  await spawned;
  if (io.stdinFrom !== undefined && child.stdin !== null) {
    const input = createReadStream(io.stdinFrom);
    input.once('error', () => child.kill('SIGTERM'));
    child.stdin.once('error', () => undefined); // the child may exit before reading everything; its status decides
    input.pipe(child.stdin);
  }
  const [code] = await closed;
  await written;
  if (code !== 0) throw new PgToolsError('pg_tools_failed');
  return { stdout };
};

/** Resolves RAI_PG_TOOLS into the three operations; `run` is injectable so the argv can be tested without Docker. */
export function resolvePgTools(
  config: Pick<BackupConfig, 'pgTools' | 'containerPort'>,
  options: { run?: ToolRunner } = {},
): PgTools {
  const run = options.run ?? spawnTool;
  const mode = config.pgTools;
  let container: Promise<string> | undefined;

  const containerId = (): Promise<string> => {
    if (mode.kind === 'docker') return Promise.resolve(mode.container);
    if (mode.kind !== 'docker-compose') throw new Error('not a docker mode');
    container ??= run(
      {
        command: 'docker',
        args: [
          'ps',
          '-q',
          '--filter',
          `label=com.docker.compose.project=${mode.project}`,
          '--filter',
          'label=com.docker.compose.service=postgres',
        ],
        env: {},
      },
      {},
    ).then(({ stdout }) => {
      const ids = stdout
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s !== '');
      if (ids.length !== 1) throw new PgToolsError('pg_tools_container_not_found');
      return ids[0]!;
    });
    return container;
  };

  const invocation = async (
    tool: 'pg_dump' | 'pg_restore',
    conn: PgConnection | null,
    args: readonly string[],
    stdin: boolean,
  ): Promise<Invocation> => {
    const target = conn === null ? [] : connectionArgs(toolTarget(mode, conn, config.containerPort));
    const password = conn?.password;
    const env: Record<string, string> = password === undefined ? {} : { PGPASSWORD: password };
    if (mode.kind === 'path') return { command: tool, args: [...target, ...args], env };
    const exec = ['exec', ...(stdin ? ['-i'] : []), ...(password === undefined ? [] : ['-e', 'PGPASSWORD'])];
    return { command: 'docker', args: [...exec, await containerId(), tool, ...target, ...args], env };
  };

  return {
    async dump(conn, args, outPath) {
      await run(await invocation('pg_dump', conn, args, false), { stdoutTo: outPath });
    },
    async restore(conn, args, inPath) {
      return run(await invocation('pg_restore', conn, args, true), { stdinFrom: inPath });
    },
    async version() {
      const { stdout } = await run(await invocation('pg_dump', null, ['--version'], false), {});
      return parseToolMajor(stdout);
    },
  };
}
