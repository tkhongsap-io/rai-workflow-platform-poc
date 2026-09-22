// W0-04 graceful shutdown (shutdown.ts): the bounded close behind start.ts close() and main.ts's SIGTERM path.
// Plain Fastify instances on ephemeral loopback ports; no Postgres. The first test is the W1-INT review finding: a
// socket that connected and never sent a byte (Chromium's speculative pre-connect while a tab is open) is not
// swept by `http.Server.close()` and used to hold the deployable open after SIGTERM indefinitely.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import { createDrain, SHUTDOWN_DRAIN_MS, type Drain } from './shutdown.js';

interface Listening {
  fastify: FastifyInstance;
  drain: Drain;
  port: number;
}

async function listen(configure: (fastify: FastifyInstance) => void = () => {}): Promise<Listening> {
  const fastify = Fastify({ logger: false });
  const drain = createDrain(fastify);
  fastify.get('/ok', () => ({ ok: true }));
  configure(fastify);
  await fastify.listen({ host: '127.0.0.1', port: 0 });
  const address = fastify.server.address();
  assert.ok(typeof address === 'object' && address !== null);
  return { fastify, drain, port: address.port };
}

/** A raw socket that connects and writes nothing, resolved once connected, with a flag set on close. */
async function silentSocket(port: number): Promise<{ socket: net.Socket; closed: () => boolean }> {
  const socket = net.connect(port, '127.0.0.1');
  let closed = false;
  socket.once('close', () => (closed = true));
  await new Promise<void>((resolve, reject) => socket.once('connect', resolve).once('error', reject));
  return { socket, closed: () => closed };
}

async function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

test('a connected socket that never sent a byte does not block close(); it is destroyed and the port is released', async () => {
  const { fastify, drain, port } = await listen();
  const control = Fastify({ logger: false }); // without the drain, the same socket holds http.Server.close() open
  await control.listen({ host: '127.0.0.1', port: 0 });
  const controlPort = (control.server.address() as net.AddressInfo).port;
  const controlSocket = await silentSocket(controlPort);
  const plain = await Promise.race([
    control.close().then(() => 'closed' as const),
    new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 1_000)),
  ]);
  assert.equal(plain, 'hung', 'the control: fastify.close() alone waits on the 0-byte socket');
  controlSocket.socket.destroy();

  const silent = await silentSocket(port);
  assert.equal(drain.inFlight(), 0);
  const startedAt = performance.now();
  await drain.close();
  const tookMs = performance.now() - startedAt;
  assert.ok(tookMs < 1_000, `close() took ${tookMs.toFixed(0)} ms with a 0-byte socket open`);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(silent.closed(), true, 'the 0-byte socket was destroyed');
  assert.equal(await portIsFree(port), true);
  assert.equal(fastify.server.listening, false);
});

test('an in-flight request is answered before its socket is destroyed; close() waits for it', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const { drain, port } = await listen((fastify) => {
    fastify.get('/slow', async () => {
      await gate;
      return { done: true };
    });
  });
  const response = fetch(`http://127.0.0.1:${port}/slow`);
  await new Promise((resolve) => setTimeout(resolve, 50)); // the request has reached the handler
  assert.equal(drain.inFlight(), 1);
  let closed = false;
  const closing = drain.close(SHUTDOWN_DRAIN_MS).then(() => (closed = true));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(closed, false, 'close() is still draining the in-flight request');
  assert.equal(drain.inFlight(), 1);
  release();
  const res = await response;
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { done: true });
  await closing;
  assert.equal(closed, true);
  assert.equal(drain.inFlight(), 0);
  assert.equal(await portIsFree(port), true);
});

test('a request still unanswered at the drain deadline is cut and close() completes', async () => {
  const { drain, port } = await listen((fastify) => {
    fastify.get('/never', () => new Promise<never>(() => {})); // never answers
  });
  const response = fetch(`http://127.0.0.1:${port}/never`);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(drain.inFlight(), 1);
  const startedAt = performance.now();
  await drain.close(200);
  const tookMs = performance.now() - startedAt;
  assert.ok(tookMs >= 150 && tookMs < 2_000, `close(200) took ${tookMs.toFixed(0)} ms`);
  await assert.rejects(response, (err: unknown) => err instanceof TypeError); // the socket was destroyed mid-request
  await new Promise((resolve) => setTimeout(resolve, 50)); // the raw response's close event follows the destroy
  assert.equal(drain.inFlight(), 0);
  assert.equal(await portIsFree(port), true);
});

test("a keep-alive socket left idle after Node's sweep does not block close()", async () => {
  const { drain, port } = await listen();
  const res = await fetch(`http://127.0.0.1:${port}/ok`); // undici keeps the socket open after the answer
  assert.equal(res.status, 200);
  await res.json();
  const startedAt = performance.now();
  await drain.close();
  assert.ok(performance.now() - startedAt < 1_000);
  assert.equal(await portIsFree(port), true);
});
