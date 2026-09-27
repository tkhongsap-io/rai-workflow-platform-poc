// Replies after 300 ms with its start and end times, so a test can see how many workers were alive at once.
import { setTimeout } from 'node:timers';

process.once('message', () => {
  const start = Date.now();
  setTimeout(() => {
    const text = JSON.stringify({ pid: process.pid, start, end: Date.now() });
    process.send({ ok: true, segments: [{ locator: { kind: 'absent' }, text }] });
  }, 300);
});
