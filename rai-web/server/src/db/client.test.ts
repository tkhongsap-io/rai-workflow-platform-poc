import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createDb } from './client.js';

test('a pool connect to a server that never answers gives up after 5 s instead of hanging', async () => {
  const sockets = new Set<net.Socket>();
  const silent = net.createServer((socket) => sockets.add(socket)); // accepts, never speaks the protocol
  await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
  const { port } = silent.address() as net.AddressInfo;
  const handle = createDb(`postgres://synthetic:synthetic@127.0.0.1:${port}/synthetic`);
  let timer: NodeJS.Timeout | undefined;
  try {
    const startedAt = performance.now();
    const outcome = await Promise.race([
      handle.pool.query('SELECT 1').then(
        () => 'answered',
        (err: Error) => err.message,
      ),
      new Promise<string>((resolve) => (timer = setTimeout(resolve, 10_000, 'still connecting after 10 s'))),
    ]);
    const tookMs = performance.now() - startedAt;
    assert.match(outcome, /timeout/i);
    assert.ok(tookMs >= 4_500, `the connect gave up after ${tookMs.toFixed(0)} ms`);
  } finally {
    clearTimeout(timer);
    for (const socket of sockets) socket.destroy(); // releases a still-connecting client so the pool can end
    await new Promise((resolve) => silent.close(resolve));
    await handle.close();
  }
});
