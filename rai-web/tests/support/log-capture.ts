import { StringDecoder } from 'node:string_decoder';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { FIXTURE_USERS } from '@rai/fixtures/data/users';

export const FIXTURE_FORBIDDEN: ReadonlyArray<string | RegExp> = [
  'RAI-DESK-SYNTHETIC-FIXTURE',
  'เอกสารประกอบ_ผู้ให้บริการ_2569.pdf',
  'operator-digest@rai-desk.example',
  ...FIXTURE_USERS.flatMap((user) => [user.email, user.displayName]),
  /Bearer /,
  /eyJ[A-Za-z0-9_-]{10,}/,
  /session=/,
  /code=/,
  /state=/,
];
export function createLogCapture() {
  let output = '';
  let decoder = new StringDecoder('utf8');
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      output += decoder.write(chunk);
      done();
    },
  });
  return {
    stream,
    text: () => output,
    clear: () => {
      output = '';
      decoder = new StringDecoder('utf8');
    },
    lines: () =>
      output
        .split('\n')
        .filter(Boolean)
        .map(
          (line) =>
            JSON.parse(line) as { event?: string; correlationId?: string; fields?: Record<string, unknown> },
        ),
  };
}
export type LogCapture = ReturnType<typeof createLogCapture>;
export function assertNoLeak(capture: Pick<LogCapture, 'text'>, forbidden = FIXTURE_FORBIDDEN): void {
  const output = capture.text();
  // Do not print the captured log on assertion failure: the leak itself may contain a secret.
  forbidden.forEach((value, index) =>
    assert.equal(
      typeof value === 'string' ? output.includes(value) : new RegExp(value.source, value.flags).test(output),
      false,
      `forbidden log canary ${index}`,
    ),
  );
}

/** Private, never-cleared audit alongside the caller's independently owned stream. */
export function createAuditedLogStream(forward?: NodeJS.WritableStream) {
  const decoder = new StringDecoder('utf8');
  let output = '';
  let failure: Error | undefined;
  function fail() {
    failure ??= new Error('OBS15 serialized log audit failed');
    // A background writer may outlive the final test hook or catch a write exception.
    // The subprocess controls prove that neither case can turn this into a passing run.
    process.exitCode = 1;
  }
  function assertClean() {
    if (failure !== undefined) throw failure;
  }
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      output += decoder.write(chunk);
      try {
        assertNoLeak({ text: () => output });
      } catch {
        fail();
      }
      if (forward === undefined) done();
      else {
        try {
          forward.write(chunk, (error?: Error | null) => {
            if (error) fail();
            done(error ? failure : undefined);
          });
        } catch {
          fail();
          done(failure);
        }
      }
    },
  });
  // Keep error diagnostics generic; retain the sticky failure for the test lifecycle.
  stream.on('error', fail);
  forward?.on('error', fail);
  return {
    stream,
    assertClean,
    async settled() {
      if (!stream.destroyed)
        await new Promise<void>((resolve) => stream.write(Buffer.alloc(0), () => resolve()));
      assertClean();
    },
  };
}
