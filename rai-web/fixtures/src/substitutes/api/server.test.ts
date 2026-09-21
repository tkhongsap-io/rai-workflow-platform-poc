// W1-13: the loopback server (`startApiSubstitute`, what a Playwright config or a dev session uses), its
// fail-closed start rule (test/development only, loopback only), the CLI entry and the in-process fetch adapter.

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SessionInfo } from '@rai/shared/schemas/auth';
import type { ArtifactRef } from '@rai/shared/schemas/artifacts';
import { findFixtureCase } from '../../data/cases/index.js';
import { SUBSTITUTE_MARKER } from '../../substitute-marker.js';
import { createSubstituteFetch } from './fetch.js';
import { createApiSubstitute } from './handler.js';
import {
  SubstituteRefused,
  assertSubstituteAllowed,
  startApiSubstitute,
  type RunningSubstitute,
} from './server.js';
import { SUBSTITUTE_HEADER } from './support.js';

const nonvendor = findFixtureCase('fx-case-nonvendor')!;
const here = path.dirname(fileURLToPath(import.meta.url));
const raiWebRoot = path.resolve(here, '..', '..', '..', '..');

describe('W1-13 substitute: loopback server, CLI and fetch adapter', () => {
  let running: RunningSubstitute;
  before(async () => {
    running = await startApiSubstitute({ nodeEnv: 'test' });
  });
  after(async () => {
    await running.close();
  });

  it('starts on 127.0.0.1 with a kernel-assigned port and answers over HTTP with the marker header', async () => {
    assert.match(running.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
    const response = await fetch(`${running.baseUrl}/auth/fixture/users`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get(SUBSTITUTE_HEADER), SUBSTITUTE_MARKER);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = (await response.json()) as { users: unknown[] };
    assert.equal(body.users.length, 8);
    const missing = await fetch(`${running.baseUrl}/api/nothing-here`);
    assert.equal(missing.status, 404);
  });

  it('a browser-style session flows through Set-Cookie, a multipart upload and a binary download', async () => {
    const signIn = await fetch(`${running.baseUrl}/auth/fixture/sign-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fixtureUserId: 'fx-user-owner-cm' }),
    });
    assert.equal(signIn.status, 200);
    const cookie = signIn.headers.get('set-cookie')?.split(';')[0] ?? '';
    assert.match(cookie, /^rai_session=/);
    assert.equal(((await signIn.json()) as SessionInfo).principal.subjectId, 'fixture:fx-user-owner-cm');
    const form = new FormData();
    form.set(
      'file',
      new Blob([new TextEncoder().encode('%PDF-1.7\n%%EOF\n')], { type: 'application/pdf' }),
      'สัญญา_ทดสอบ.pdf',
    );
    const upload = await fetch(`${running.baseUrl}/api/cases/${nonvendor.caseId}/artifacts`, {
      method: 'POST',
      headers: { cookie },
      body: form,
    });
    const uploadText = await upload.text();
    assert.equal(upload.status, 201, uploadText);
    const ref = JSON.parse(uploadText) as ArtifactRef;
    assert.equal(ref.filename, 'สัญญา_ทดสอบ.pdf');
    const download = await fetch(`${running.baseUrl}/api/artifacts/${ref.artifactId}`, {
      headers: { cookie },
    });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'application/pdf');
    assert.equal(new TextDecoder().decode(await download.arrayBuffer()), '%PDF-1.7\n%%EOF\n');
    assert.equal((await fetch(`${running.baseUrl}/api/artifacts/${ref.artifactId}`)).status, 401);
  });

  it('refuses to start outside NODE_ENV test/development and off loopback (fail closed)', async () => {
    for (const nodeEnv of ['production', 'staging', ''])
      await assert.rejects(
        startApiSubstitute({ nodeEnv }),
        (err: unknown) => err instanceof SubstituteRefused && err.reason === 'node_env',
      );
    await assert.rejects(
      startApiSubstitute({ nodeEnv: 'test', host: '0.0.0.0' }),
      (err: unknown) => err instanceof SubstituteRefused && err.reason === 'not_loopback',
    );
    assert.throws(() => assertSubstituteAllowed('test', '192.168.1.10'), SubstituteRefused);
    assert.doesNotThrow(() => assertSubstituteAllowed('development', '127.0.0.1'));
    assert.doesNotThrow(() => assertSubstituteAllowed('test', '::1'));
  });

  it('the CLI entry prints substitute.started with the marker and stops on SIGTERM; exit 78 when refused', async () => {
    const entry = path.join(here, 'serve.ts');
    const tsx = path.join(raiWebRoot, 'node_modules', '.bin', 'tsx');
    const child = spawn(tsx, ['--conditions=rai-source', entry, '--port', '0'], {
      cwd: raiWebRoot,
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    const started = await new Promise<{ event: string; marker: string; baseUrl: string }>(
      (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`serve.ts did not start: ${stdout}`)), 30_000);
        child.stdout.on('data', () => {
          const line = stdout.split('\n').find((l) => l.includes('substitute.started'));
          if (line !== undefined) {
            clearTimeout(timer);
            resolve(JSON.parse(line) as { event: string; marker: string; baseUrl: string });
          }
        });
        child.on('exit', (code) => reject(new Error(`exited ${code} before starting: ${stdout}`)));
      },
    );
    assert.equal(started.marker, SUBSTITUTE_MARKER);
    const probe = await fetch(`${started.baseUrl}/auth/fixture/users`);
    assert.equal(probe.status, 200);
    const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
    child.kill('SIGTERM');
    assert.equal(await exited, 0);

    const refused = spawn(tsx, ['--conditions=rai-source', entry, '--port', '0'], {
      cwd: raiWebRoot,
      env: { ...process.env, NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    refused.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const code = await new Promise<number | null>((resolve) => refused.on('exit', (c) => resolve(c)));
    assert.equal(code, 78);
    assert.ok(stderr.includes('substitute.refused'));
  });

  it('createSubstituteFetch keeps the session cookie between calls and drops it on sign-out', async () => {
    const substitute = createApiSubstitute();
    const fetchLike = createSubstituteFetch(substitute);
    assert.equal((await fetchLike('/api/session')).status, 401);
    const signIn = await fetchLike('/auth/fixture/sign-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fixtureUserId: 'fx-user-spoc-cm' }),
    });
    assert.equal(signIn.status, 200);
    assert.equal(fetchLike.cookies.size, 1);
    const session = await fetchLike(new URL('http://127.0.0.1:5174/api/session'));
    assert.equal(session.status, 200);
    assert.equal(((await session.json()) as SessionInfo).principal.subjectId, 'fixture:fx-user-spoc-cm');
    const list = await fetchLike(new Request('http://127.0.0.1:5174/api/cases?pageSize=1'));
    assert.equal(list.status, 200);
    assert.equal(((await list.json()) as { total: number }).total, 2);
    const locale = await fetchLike('/api/session/locale', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale: 'en' }),
    });
    assert.equal(locale.status, 204);
    assert.equal(await locale.text(), '');
    const out = await fetchLike('/auth/sign-out', { method: 'POST' });
    assert.equal(out.status, 204);
    assert.equal(fetchLike.cookies.size, 0);
    assert.equal((await fetchLike('/api/session')).status, 401);
  });
});
