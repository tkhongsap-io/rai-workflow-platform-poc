// Explicit reviewed page-only resume. Never import. No seeding or mutation-profile calls.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { Api, hash, validateManifest, queueShape } from '../../tests/performance/core.ts';
import { guardPlan } from '../../tests/performance/profiles.ts';
import { pagePaths, validatePages, measurePages } from '../../tests/performance/page-measure.ts';
import { startPerformanceServer } from '../../tests/performance/server-launcher.ts';
import { guardLaunch } from '../../tests/performance/server-contract.ts';
import { recipe } from '../../tests/performance/seed-recipe.ts';
const SEED = '0c99d61a61585dca51b333e95886476830419053';
const PRODUCT = '27ad01b1ba8179f286660959043c0e178fd51b35';
const READY = {
  queue: '[data-testid="queue-count"]',
  overview: '.case-head',
  editor: '[aria-labelledby="pack-heading"]',
  reviewer: '[data-review-controls="ready"]',
  history: '.versions-nav',
};
const sha = (x) => createHash('sha256').update(x).digest('hex');
const json = async (f) => JSON.parse(await readFile(f, 'utf8'));
const exclusive = (f, x) => writeFile(f, JSON.stringify(x, null, 2), { flag: 'wx', mode: 0o600 });
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
let stage = 'input-gates';
async function main() {
  const [mode, inputFile] = process.argv.slice(2);
  assert(['diagnostic', 'measure'].includes(mode));
  assert(path.isAbsolute(inputFile));
  const stat = await lstat(inputFile);
  assert(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0);
  const input = await json(inputFile);
  assert.equal(input.go[mode], 'parent-explicit-go');
  assert.equal(input.review.clean, true);
  assert.equal(input.review.driverSha256, sha(await readFile(fileURLToPath(import.meta.url))));
  assert.equal(input.localTestsIdle, true);
  assert(/^[a-f0-9]{40}$/.test(input.measurementHead));
  assert.notEqual(input.measurementHead, SEED);
  assert.equal(git('rev-parse', 'HEAD'), input.measurementHead);
  assert.equal(git('status', '--porcelain', '--untracked-files=no'), '');
  const root = await realpath('.');
  const old = path.join(root, '.local/performance/w306_20260923_a01');
  const out = path.join(root, '.local/performance/w306_20260923_pages_b02');
  assert.equal(input.sourceDir, old);
  assert.equal(input.outputDir, out);
  assert.equal(
    sha(await readFile('.local/performance-review-v1/driver.mjs')),
    '907e9868fb1bb230c4165fa151350756872044f22b2b2b479342a4fe42653c09',
  );
  for (const [name, digest] of Object.entries(input.sourceHashes)) {
    assert(/^[a-zA-Z0-9_.-]+$/.test(name));
    assert.equal(sha(await readFile(path.join(old, name))), digest);
  }
  for (const name of [
    'measurement-plan.json',
    'setup-complete.json',
    'queue-manifest.json',
    'mutation-bindings.json',
    'queue-launch.json',
    'mutation-launch.json',
    'source-fingerprint.json',
    'build-assets.json',
    'profiles-page-overview.jsonl',
    'queue-samples.jsonl',
    'profiles-page-queue.jsonl',
  ])
    assert(input.sourceHashes[name]);
  const raw = await json(path.join(old, 'measurement-plan.json'));
  const complete = await json(path.join(old, 'setup-complete.json'));
  const manifest = await json(path.join(old, 'queue-manifest.json'));
  const bindings = await json(path.join(old, 'mutation-bindings.json'));
  assert.equal(hash(raw), complete.planHash);
  assert.equal(hash(bindings), complete.mutationBindingsHash);
  assert.equal(complete.builtHead, SEED);
  assert.equal(complete.candidateIntHead, PRODUCT);
  validateManifest(manifest, SEED);
  assert.equal(manifest.sha256, complete.manifestHash);
  assert.equal(raw.queue.finalHead, SEED);
  assert.equal(raw.mutation.finalHead, SEED);
  const fingerprint = await json(path.join(old, 'source-fingerprint.json'));
  assert.equal(fingerprint.builtHead, SEED);
  assert.equal(fingerprint.candidateIntHead, PRODUCT);
  assert.equal(fingerprint.productionConfigCompared, true);
  assert(fingerprint.inventory.length > 0);
  for (const entry of fingerprint.inventory)
    assert.equal(git('rev-parse', `${input.measurementHead}:${entry.path}`), entry.gitObject);
  // Root manifest differed from PRODUCT only by previously approved verification commands; no further delta.
  assert.equal(
    git('rev-parse', `${SEED}:rai-web/package.json`),
    git('rev-parse', `${input.measurementHead}:rai-web/package.json`),
  );
  const assets = await json(path.join(old, 'build-assets.json'));
  assert.equal(assets.head, SEED);
  for (const entry of assets.files) {
    assert(/^(server|shared|web|fixtures)\/dist\//.test(entry.path));
    assert(!entry.path.includes('..'));
    assert.equal(sha(await readFile(entry.path)), entry.sha256);
  }
  assert.equal(bindings.length, 48);
  assert.equal(new Set(bindings.map((x) => x.caseId)).size, 48);
  assert.deepEqual(
    bindings.map((x) => x.key).sort((a, b) => a - b),
    Array.from({ length: 48 }, (_, i) => i),
  );
  // Pin the retained owned Compose instance before any application startup.
  assert.equal(input.expectedContainerId, 'cc7d0137ffede4c8b72f4cb6dfdf4b90722c3bbd0f3602cab023c4a58c4f5011');
  const container = JSON.parse(
    execFileSync('docker', ['inspect', input.expectedContainerId], { encoding: 'utf8' }),
  )[0];
  assert.equal(container.Id, input.expectedContainerId);
  assert.equal(container.State.Running, true);
  assert.equal(container.Config.Labels['com.docker.compose.project'], 'rai-w3-performance');
  assert.equal(container.Config.Labels['com.docker.compose.service'], 'postgres');
  assert.deepEqual(container.NetworkSettings.Ports['5432/tcp'], [{ HostIp: '127.0.0.1', HostPort: '54370' }]);
  const configs = {};
  const plan = structuredClone(raw);
  for (const [target, port] of [
    ['queue', 60870],
    ['mutation', 60871],
  ]) {
    const launch = await json(path.join(old, `${target}-launch.json`));
    guardLaunch(launch);
    assert.deepEqual(launch.queue, raw.queue);
    assert.deepEqual(launch.mutation, raw.mutation);
    assert.equal(launch.target, target);
    assert.equal(launch.serverRoot, root);
    assert.equal(launch.resourceRoot, `/private/tmp/rai-perf-${target}-w306_20260923_a01`);
    assert.equal(raw[target].target.database, `rai_perf_${target}_w306_20260923_a01`);
    assert.equal(raw[target].baseUrl, `http://127.0.0.1:${port}`);
    launch.queue.finalHead = input.measurementHead;
    launch.mutation.finalHead = input.measurementHead;
    guardLaunch(launch);
    configs[target] = launch;
    plan[target].finalHead = input.measurementHead;
  }
  plan.outputPrefix = path.join(out, 'profiles');
  guardPlan(plan);
  if (mode === 'diagnostic') {
    await mkdir(out, { mode: 0o700 });
    assert.equal(await realpath(out), out);
    for (const target of ['queue', 'mutation'])
      await exclusive(path.join(out, `${target}-launch.json`), configs[target]);
  } else {
    assert.equal(await realpath(out), out);
    assert.equal(input.review.diagnosticClean, true);
    assert.equal(
      sha(await readFile(path.join(out, 'diagnostic-complete.json'))),
      input.review.diagnosticSha256,
    );
    for (const target of ['queue', 'mutation'])
      assert.deepEqual(await json(path.join(out, `${target}-launch.json`)), configs[target]);
  }
  const provenance = {
    seedHead: SEED,
    measurementHead: input.measurementHead,
    productHead: PRODUCT,
    sourceHashes: input.sourceHashes,
    driverSha256: input.review.driverSha256,
    candidateEvidenceOnly: true,
  };
  await exclusive(path.join(out, `${mode}-started.json`), { ...provenance, state: 'INCOMPLETE' });
  stage = 'startup';
  let proof;
  const queue = await startPerformanceServer(
    path.join(out, 'queue-launch.json'),
    path.join(out, `${mode}-queue-server.jsonl`),
  );
  try {
    const mutation = await startPerformanceServer(
      path.join(out, 'mutation-launch.json'),
      path.join(out, `${mode}-mutation-server.jsonl`),
    );
    try {
      for (let key = 0; key < 995; key++) {
        const matches = manifest.rows.filter(
          (r) =>
            r.sourceRecordId.kind === 'known' && r.sourceRecordId.value === recipe(key).sourceRecordId.value,
        );
        assert.equal(matches.length, 1);
        await queue.enroll(key, matches[0].caseId);
      }
      for (const row of bindings) await mutation.enroll(row.key, row.caseId);
      await queue.settled();
      await mutation.settled();
      stage = 'retained-state-and-routes';
      const admin = new Api(plan.queue.baseUrl);
      await admin.signIn('fx-user-admin');
      const current = [];
      for (let page = 1; page <= 10; page++) {
        const response = await admin.json(`/api/queue?page=${page}&pageSize=100`);
        queueShape(response);
        assert.equal(response.total, 1000);
        current.push(...response.items);
      }
      const invariant = (rows) =>
        rows
          .map((r) => ({
            caseId: r.caseId,
            status: r.status,
            currentVersionNumber: r.currentVersionNumber,
            latestVersionNumber: r.latestVersionNumber,
          }))
          .sort((a, b) => a.caseId.localeCompare(b.caseId));
      assert.deepEqual(invariant(current), invariant(manifest.rows));
      const api = new Api(plan.mutation.baseUrl);
      await api.signIn('fx-user-owner-cm');
      const readState = async () => {
        const views = [];
        for (const key of [47, 45, 46])
          views.push(await api.json(`/api/cases/${bindings.find((x) => x.key === key).caseId}`));
        const [ready, editor, cycle] = views;
        assert.equal(ready.status, 'ready_for_launch');
        assert.equal(ready.draft, null);
        assert.equal(ready.currentVersion.versionNumber, 1);
        assert.equal(editor.status, 'draft');
        assert(editor.draft);
        assert.equal(editor.currentVersion, null);
        assert.equal(cycle.status, 'in_review');
        assert.equal(cycle.draft, null);
        assert.equal(cycle.currentVersion.versionNumber, 2);
        return views.map((v) => ({
          caseId: v.caseId,
          status: v.status,
          currentVersionId: v.currentVersion?.versionId ?? null,
          draftVersionId: v.draft?.draftId ?? null,
        }));
      };
      const stateBefore = await readState();
      const [ready, editor, cycle] = stateBefore;
      const overview = plan.pages.find((p) => p.kind === 'overview');
      assert.equal(overview.ids.caseId, ready.caseId);
      overview.ids.versionId = ready.currentVersionId;
      assert.equal(plan.pages.find((p) => p.kind === 'editor').ids.caseId, editor.caseId);
      const reviewer = plan.pages.find((p) => p.kind === 'reviewer');
      assert.equal(reviewer.ids.caseId, cycle.caseId);
      assert.equal(reviewer.ids.versionId, cycle.currentVersionId);
      const history = plan.pages.find((p) => p.kind === 'history');
      assert.equal(history.ids.caseId, cycle.caseId);
      assert.equal(
        (await api.json(`/api/cases/${history.ids.caseId}/versions/${history.ids.versionId}`)).versionNumber,
        1,
      );
      overview.visible.push(
        '#frozen-heading:has-text("เวอร์ชัน 1")',
        `.versions-nav a[href="/cases/${ready.caseId}/versions/${ready.currentVersionId}"][aria-current="page"]`,
      );
      validatePages(plan.pages);
      for (const p of plan.pages)
        assert.equal(
          p.actor,
          p.kind === 'queue' ? 'fx-user-dpo' : p.kind === 'reviewer' ? 'fx-user-ai-coe' : 'fx-user-owner-cm',
        );
      proof = {
        ...provenance,
        queueCases: current.length,
        stateBefore,
        pages: plan.pages,
        routes: plan.pages.map((p) => ({ kind: p.kind, ...pagePaths(p) })),
      };
      if (mode === 'diagnostic') {
        await exclusive(path.join(out, 'measurement-plan.json'), plan);
        const browser = await chromium.launch();
        const observations = [];
        try {
          for (const selection of plan.pages) {
            stage = `diagnostic-${selection.kind}`;
            const target = selection.kind === 'queue' ? 'queue' : 'mutation';
            const control = target === 'queue' ? queue : mutation;
            await control.settled();
            const origin = plan[target].baseUrl;
            const routes = pagePaths(selection);
            const context = await browser.newContext({
              baseURL: origin,
              viewport: { width: 1440, height: 900 },
              locale: 'th-TH',
            });
            try {
              assert.equal(
                (
                  await context.request.post('/auth/fixture/sign-in', {
                    data: { fixtureUserId: selection.actor },
                    headers: { 'sec-fetch-site': 'same-origin' },
                  })
                ).status(),
                200,
              );
              assert.equal(
                (
                  await context.request.post('/api/session/locale', {
                    data: { locale: 'th' },
                    headers: { 'sec-fetch-site': 'same-origin' },
                  })
                ).status(),
                204,
              );
              const page = await context.newPage();
              const requests = [];
              page.on('response', (r) => {
                const u = new URL(r.url());
                if (u.origin === origin)
                  requests.push({
                    method: r.request().method(),
                    path: u.pathname.replace(/[a-f0-9]{8}-[a-f0-9-]{27}/g, ':id'),
                    status: r.status(),
                  });
              });
              assert.equal(
                (await page.goto(routes.entry, { waitUntil: 'domcontentloaded', timeout: 30000 }))?.status(),
                200,
              );
              const finalUrl = new URL(routes.final, origin).href;
              await expect(page).toHaveURL(finalUrl);
              await expect(page.locator('html')).toHaveAttribute('lang', 'th');
              for (const s of [READY[selection.kind], ...selection.visible])
                await expect(page.locator(s)).toBeVisible();
              for (const s of ['[data-review-qc="loading"]', ...selection.absent])
                await expect(page.locator(s)).toHaveCount(0);
              await page.evaluate(
                () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
              );
              await expect(page).toHaveURL(finalUrl);
              await control.settled();
              observations.push({
                kind: selection.kind,
                ...routes,
                finalObserved: new URL(page.url()).pathname,
                requests,
                loadedAssertionsPassed: true,
              });
              await exclusive(path.join(out, `diagnostic-${selection.kind}.json`), observations.at(-1));
            } finally {
              await context.close();
            }
          }
        } finally {
          await browser.close();
        }
        assert.deepEqual(await readState(), stateBefore);
        proof = { ...proof, observations, stateAfter: await readState() };
      } else {
        const diagnostic = await json(path.join(out, 'diagnostic-complete.json'));
        const { observations, stateAfter, ...prior } = diagnostic;
        assert(observations.length === 5);
        assert.deepEqual(stateAfter, stateBefore);
        assert.deepEqual(proof, prior);
        assert.deepEqual(plan, await json(path.join(out, 'measurement-plan.json')));
        stage = 'five-page-measurement';
        await measurePages(
          {
            ...plan,
            readLog: (target) => readFile(path.join(out, `measure-${target}-server.jsonl`), 'utf8'),
          },
          { queue, mutation },
        );
        assert.deepEqual(await readState(), stateBefore);
      }
    } finally {
      await mutation.stop();
    }
  } finally {
    await queue.stop();
  }
  await exclusive(path.join(out, `${mode}-complete.json`), proof);
  console.log(JSON.stringify({ event: 'page_resume_complete', mode, candidateEvidenceOnly: true }));
}
try {
  await main();
} catch {
  console.error(
    JSON.stringify({ event: 'page_resume_failed', stage, partialEvidenceRetained: true, noRetry: true }),
  );
  process.exitCode = 1;
}
