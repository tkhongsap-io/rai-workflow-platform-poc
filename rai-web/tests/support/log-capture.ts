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
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      output += chunk.toString('utf8');
      done();
    },
  });
  return {
    stream,
    text: () => output,
    clear: () => {
      output = '';
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
