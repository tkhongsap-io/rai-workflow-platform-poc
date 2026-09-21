// W1-INT review round 1: the deployable's W0-04 graceful shutdown is bounded end to end (main.ts → start.ts →
// shutdown.ts), and the test harness never waits forever on a stop. The first case is the CI finding: with a
// browser tab open Chromium holds a speculative pre-connect socket that sent 0 bytes, which Node's idle sweep
// never closes, so `fastify.close()` alone never resolved and SIGTERM hung the process. Here the same socket is a
// plain `net.connect` that writes nothing. Fixture ids: none (no request is made).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startTestServer } from '../support/process.js';

async function silentSocket(port: number): Promise<net.Socket> {
  const socket = net.connect(port, '127.0.0.1');
  await new Promise<void>((resolve, reject) => socket.once('connect', resolve).once('error', reject));
  return socket;
}

describe('W1-INT graceful shutdown is bounded', () => {
  it('SIGTERM exits 0 within the drain budget while a connected socket that never sent a byte is held open', async () => {
    const server = await startTestServer();
    const socket = await silentSocket(server.port);
    try {
      const startedAt = performance.now();
      const exit = await server.stop();
      const tookMs = performance.now() - startedAt;
      assert.deepEqual(exit, { code: 0, signal: null });
      assert.ok(tookMs < 5_000, `the stop took ${tookMs.toFixed(0)} ms with a 0-byte socket open`);
      assert.equal(server.linesFor('process.stopping').length, 1);
    } finally {
      socket.destroy();
    }
  });

  it('a request in flight at SIGTERM is answered before the process exits', async () => {
    const server = await startTestServer();
    // Headers complete, body withheld: the request has been accepted (Fastify's onRequest ran) and is waiting
    // for its body when the signal arrives, which is what an in-flight transaction looks like to the drain.
    const body = JSON.stringify({ fixtureUserId: 'fx-user-admin' });
    const socket = await silentSocket(server.port);
    const answered = new Promise<string>((resolve) => {
      let text = '';
      socket.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
      socket.once('close', () => resolve(text));
    });
    socket.write(
      [
        'POST /auth/fixture/sign-in HTTP/1.1',
        `Host: 127.0.0.1:${server.port}`,
        'Content-Type: application/json',
        'Sec-Fetch-Site: same-origin',
        `Content-Length: ${Buffer.byteLength(body)}`,
        '',
        '',
      ].join('\r\n'),
    );
    await new Promise((resolve) => setTimeout(resolve, 200)); // the headers have reached the handler chain
    const stopping = server.stop();
    await new Promise((resolve) => setTimeout(resolve, 200)); // SIGTERM handled: process.stopping logged, draining
    assert.equal(server.linesFor('process.stopping').length, 1);
    socket.write(body);
    const exit = await stopping;
    assert.deepEqual(exit, { code: 0, signal: null });
    const answer = await answered;
    assert.match(answer, /^HTTP\/1\.1 200 /);
    assert.match(answer, /"identityMode":"fixture"/);
  });

  it('stop() escalates to SIGKILL after the grace period and rejects with the captured lines', async () => {
    const server = await startTestServer();
    process.kill(server.pid, 'SIGSTOP'); // frozen: the SIGTERM handler cannot run, as a hung shutdown would look
    try {
      await assert.rejects(
        server.stop(500),
        (err: Error) =>
          err.message.includes('did not exit within 500 ms of SIGTERM; killed') &&
          err.message.includes('process.started'),
      );
      await assert.rejects(server.stop(), /did not exit within 500 ms/); // idempotent: the same settled promise
    } finally {
      try {
        process.kill(server.pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  });
});
