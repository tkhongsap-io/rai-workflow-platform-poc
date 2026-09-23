// Real HTTP/SQL and file-sink journey. Keyboard controls; native file chooser is bridged after Enter.
import { test, expect, type Page, type Locator, type Request } from '@playwright/test';
import { randomUUID, createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { t, type LocaleKey } from '@rai/shared/locales/keys';
import { NOTIFICATION_EVENT_BY_KIND, type DeliveryRequest } from '@rai/shared/mail/types';
import type { SubmittedVersion } from '@rai/shared/schemas/versions';
import { buildPdf } from '@rai/fixtures/generate/pdf';
import { FIXTURE_THAI_LINE } from '@rai/fixtures/data/documents/index';
import { expectAccessible } from './support/axe.js';
import { expectMainFocused, expectVisibleFocus, tabTo } from './support/keyboard.js';
import { withIsolatedFixtureDatabase } from './support/isolated-database.js';
import { startJourneyServer } from './support/journey-server.js';

test.use({ video: 'on' });

const label = (key: LocaleKey) => t('th', key);
const button = (page: Page, key: LocaleKey) => page.getByRole('button', { name: label(key), exact: true });
async function activate(page: Page, target: Locator) {
  await tabTo(page, target);
  await page.keyboard.press('Enter');
}
async function type(page: Page, target: Locator, value: string) {
  await tabTo(page, target);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(value);
}
async function select(page: Page, target: Locator, value: string) {
  await tabTo(page, target);
  const text = await target.evaluate(
    (el, wanted) =>
      Array.from((el as HTMLSelectElement).options).find((o) => o.value === wanted)?.textContent,
    value,
  );
  expect(text).toBeTruthy();
  // Chromium/macOS headless native menus ignore arrows. Native type-ahead works;
  // CDP key events support Thai characters that Playwright keyboard.type inserts as text instead.
  const keyboard = await page.context().newCDPSession(page);
  try {
    for (const key of text!) {
      await keyboard.send('Input.dispatchKeyEvent', { type: 'keyDown', key, text: key, unmodifiedText: key });
      await keyboard.send('Input.dispatchKeyEvent', { type: 'keyUp', key });
    }
  } finally {
    await keyboard.detach();
  }
  await expect(target).toHaveValue(value);
}
async function radio(page: Page, target: Locator) {
  const name = await target.getAttribute('name');
  await tabTo(page, page.locator(`input[name="${name}"]:checked`));
  for (let i = 0; i < 8 && !(await target.isChecked()); i++) await page.keyboard.press('ArrowRight');
  await expect(target).toBeChecked();
  await expectVisibleFocus(page);
}
async function signIn(page: Page, origin: string, user: string, route = '/queue') {
  await page.goto(`${origin}/sign-in?returnTo=${encodeURIComponent(route)}`);
  await select(page, page.getByLabel(label('auth.fixture_user_select')), user);
  await activate(page, button(page, 'auth.sign_in'));
  await expect(page).toHaveURL(`${origin}${route}`);
}
async function signOut(page: Page) {
  await activate(page, button(page, 'auth.sign_out'));
  await activate(
    page,
    page.getByRole('dialog').getByRole('button', { name: label('auth.sign_out'), exact: true }),
  );
  await expect(page).toHaveURL(/\/sign-in/);
}
async function submit(page: Page, caseId: string) {
  await expect(button(page, 'pack.action.submit')).toBeEnabled();
  await activate(page, button(page, 'pack.action.submit'));
  await expect(page).toHaveURL(new RegExp(`/cases/${caseId}/versions/[0-9a-f-]{36}$`));
  await expect(page.getByRole('navigation', { name: label('version.nav_heading') })).toBeVisible();
  await expectMainFocused(page);
  return page.url().split('/').at(-1)!;
}
async function mails(dir: string): Promise<DeliveryRequest[]> {
  return Promise.all(
    (await readdir(dir))
      .filter((n) => n.endsWith('.json'))
      .map(
        async (name) =>
          (JSON.parse(await readFile(path.join(dir, name), 'utf8')) as { request: DeliveryRequest }).request,
      ),
  );
}

test('one keyboard case: create/upload/submit/restart/queue/mail/send-back/v2/disposition/Ready', async ({
  page,
}, info) => {
  test.setTimeout(240000);
  await withIsolatedFixtureDatabase(async (env) => {
    let server = await startJourneyServer(env);
    const origin = server.baseUrl;
    const db = new pg.Client({ connectionString: env.DATABASE_OPERATOR_URL });
    await db.connect();
    try {
      await signIn(page, origin, 'fx-user-owner-cm');
      await expect(page.getByTestId('queue-count')).toBeVisible();
      await expectMainFocused(page);
      await activate(
        page,
        page
          .getByRole('navigation', { name: label('shell.nav_label') })
          .getByRole('link', { name: label('shell.nav.new_case'), exact: true }),
      );
      await expectMainFocused(page);
      const name = `W3-INT เอกสารสังเคราะห์ ${randomUUID().slice(0, 8)}`;
      for (const [key, value] of [
        ['field.use_case_name', name],
        ['field.business_unit_id', 'CM'],
        ['field.business_unit', 'Consumer Mobile'],
        ['field.technical_owner', 'Synthetic technical owner'],
      ] as const)
        await type(page, page.getByLabel(label(key)), value);
      await select(page, page.getByLabel(label('field.use_case_group')), 'customer-service');
      await radio(page, page.getByLabel(label('model_type.classic_ml'), { exact: true }));
      await expect(page.getByLabel(label('common.no'), { exact: true })).toBeChecked();
      await activate(page, button(page, 'new_case.submit'));
      await expect(page.getByTestId('case-count')).toBeVisible();
      await expectMainFocused(page);
      await activate(
        page,
        page.locator('article[data-registry-id]').filter({ hasText: name }).getByRole('link'),
      );
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
      await expectMainFocused(page);
      const caseId = page.url().split('/').at(-1)!;
      await server.bindCase(caseId);
      await expect(page.locator('.slot-row')).toHaveCount(9);
      for (const slot of [3, 4])
        await expect(page.locator(`[data-slot="${slot}"]`)).toContainText(
          label('slot.na.reason.non_vendor_default'),
        );
      await activate(
        page,
        page.getByRole('button', {
          name: t('th', 'pack.change_slot', { number: 1, name: label('slot.s1.name') }),
          exact: true,
        }),
      );
      const dialog = page.getByRole('dialog');
      await radio(page, dialog.getByRole('radio', { name: label('slot.state.attached'), exact: false }));
      const bytes = buildPdf({
        asciiLines: ['RAI-DESK-SYNTHETIC-FIXTURE W3-INT'],
        thaiLine: FIXTURE_THAI_LINE,
        title: 'W3 INT',
      });
      await tabTo(page, dialog.locator('input[type="file"]'));
      const chooser = page.waitForEvent('filechooser');
      await page.keyboard.press('Enter');
      await (
        await chooser
      ).setFiles({ name: 'w3-int-synthetic.pdf', mimeType: 'application/pdf', buffer: bytes });
      await activate(page, dialog.getByRole('button', { name: label('slot.dialog.apply'), exact: true }));
      await expect(dialog).toBeHidden();
      await activate(page, button(page, 'pack.action.save'));
      await expect(page.getByRole('status')).toContainText(t('th', 'pack.saved', { revision: 2 }));
      const v1 = await submit(page, caseId);
      const versionUrl = `${origin}/api/cases/${caseId}/versions/${v1}`;
      const frozen = await (await page.request.get(versionUrl)).text();
      const parsed = JSON.parse(frozen) as SubmittedVersion;
      const artifact = parsed.slots[1];
      expect(artifact.state).toBe('attached');
      if (artifact.state !== 'attached') throw new Error('missing uploaded artifact');
      expect(artifact.artifact.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      await expectAccessible(page, info, { name: 'combined-v1-th', lang: 'th' });
      await expect
        .poll(async () => (await mails(env.MAIL_SINK_DIR!)).filter((m) => m.event.versionId === v1).length)
        .toBe(4);
      const firstPid = server.pid;
      const port = server.port;
      expect(await server.stop()).toBe(0);
      server = await startJourneyServer(env, port);
      await server.bindCase(caseId);
      expect(server.pid).not.toBe(firstPid);
      expect(await (await page.request.get(versionUrl)).text()).toBe(frozen);
      await page.reload();
      await expect(page.getByRole('navigation', { name: label('version.nav_heading') })).toBeVisible();
      await activate(page, page.getByRole('link', { name: label('queue.title'), exact: true }));
      await expect(page.getByTestId('queue-count')).toBeVisible();
      await expectMainFocused(page);
      await type(page, page.getByLabel(label('queue.search'), { exact: true }), name);
      await activate(page, button(page, 'queue.apply'));
      const card = page.locator('article[data-registry-id]');
      await expect(card).toHaveCount(1);
      await expect(card).toContainText(label('queue.next.review_lanes'));
      await expectAccessible(page, info, { name: 'combined-queue-th', lang: 'th' });
      const laneMail = (await mails(env.MAIL_SINK_DIR!)).find(
        (m) => m.event.versionId === v1 && m.recipient.recipientId === 'fixture:fx-user-ai-coe',
      )!;
      expect(laneMail.event.kind).toBe('lane_opened');
      const link = laneMail.deepLinks[0]!.url;
      expect(new URL(link).origin).toBe(origin);
      expect(new URL(link).search).toBe('');
      expect(new URL(link).hash).toBe('');
      await signOut(page);
      await page.goto(link);
      await expect(page).toHaveURL(
        `${origin}/sign-in?returnTo=${encodeURIComponent(new URL(link).pathname)}`,
      );
      await select(page, page.getByLabel(label('auth.fixture_user_select')), 'fx-user-owner-cm-2');
      await activate(page, button(page, 'auth.sign_in'));
      await expect(page.getByRole('alert')).toContainText(label('error.forbidden'));
      await signOut(page);
      await signIn(page, origin, 'fx-user-ai-coe', new URL(link).pathname);
      await expect(page.locator('[data-review-controls="ready"]')).toBeVisible();
      await expectMainFocused(page);
      await activate(page, button(page, 'review.action.send_back'));
      await select(page, dialog.locator('select'), '1');
      await type(page, dialog.locator('textarea[required]'), 'Synthetic slot 1 clarification required');
      await activate(
        page,
        dialog.getByRole('button', { name: label('review.send_back.submit'), exact: true }),
      );
      await expect(dialog).toBeHidden();
      await expect
        .poll(async () =>
          (await mails(env.MAIL_SINK_DIR!)).some(
            (m) => m.event.kind === 'sent_back' && m.event.versionId === v1,
          ),
        )
        .toBe(true);
      const backMail = (await mails(env.MAIL_SINK_DIR!)).find(
        (m) => m.event.kind === 'sent_back' && m.event.versionId === v1,
      )!;
      expect(backMail.recipient.recipientId).toBe('fixture:fx-user-owner-cm');
      await signOut(page);
      await signIn(page, origin, 'fx-user-owner-cm', new URL(backMail.deepLinks[0]!.url).pathname);
      await expect(page.getByRole('navigation', { name: label('version.nav_heading') })).toBeVisible();
      await expectMainFocused(page);
      await activate(
        page,
        page.getByRole('link', { name: t('th', 'version.nav_draft', { number: 2 }), exact: false }),
      );
      await expectMainFocused(page);
      await activate(
        page,
        page.getByRole('button', {
          name: t('th', 'pack.change_slot', { number: 7, name: label('slot.s7.name') }),
          exact: true,
        }),
      );
      await radio(page, dialog.getByRole('radio', { name: label('slot.state.not_yet'), exact: false }));
      await activate(page, dialog.getByRole('button', { name: label('slot.dialog.apply'), exact: true }));
      await expect(dialog).toBeHidden();
      await activate(page, button(page, 'pack.action.save'));
      await expect(page.getByRole('status')).toContainText(
        t('th', 'pack.saved', { revision: '¶' }).split('¶')[0]!,
      );
      const v2 = await submit(page, caseId);
      expect(v2).not.toBe(v1);
      const versionPath = `/cases/${caseId}/versions/${v2}`;
      await signOut(page);
      await signIn(page, origin, 'fx-user-ai-coe', versionPath);
      await expect(page.locator('[data-review-qc="findings"] [data-finding-id]').first()).toBeVisible();
      const findingId = await page
        .locator('[data-review-qc="findings"] [data-finding-id]')
        .first()
        .getAttribute('data-finding-id');
      await signOut(page);
      await signIn(page, origin, 'fx-user-owner-cm', versionPath);
      await expectMainFocused(page);
      await activate(page, button(page, 'review.disposition.fixed_proposed'));
      await expect(
        page.locator(`[data-finding-id="${findingId}"] [data-disposition-kind="fixed_proposed"]`),
      ).toBeVisible();
      await signOut(page);
      await signIn(page, origin, 'fx-user-ai-coe', versionPath);
      await expectMainFocused(page);
      await activate(page, button(page, 'review.disposition.fixed_confirmed'));
      await expect(
        page.locator(`[data-finding-id="${findingId}"] [data-disposition-kind="fixed_confirmed"]`),
      ).toBeVisible();
      // Arm synchronously at the exact final approval response, before React can rerender.
      // Requests initiated before that boundary are legitimate preapproval QC.
      let finalApprovalSucceeded = false;
      let readyFindingsGets = 0;
      const readyFindingsRequests = new WeakSet<Request>();
      const qcPostsAfterReady: string[] = [];
      const apiVersionPath = `/api/cases/${caseId}/versions/${v2}`;
      page.on('response', (response) => {
        const request = response.request();
        const pathname = new URL(response.url()).pathname;
        if (
          request.method() === 'POST' &&
          pathname === `${apiVersionPath}/lanes/it_security/approve` &&
          response.status() === 201
        )
          finalApprovalSucceeded = true;
        if (
          readyFindingsRequests.has(request) &&
          request.method() === 'GET' &&
          pathname === `${apiVersionPath}/findings` &&
          response.status() === 200
        )
          readyFindingsGets += 1;
      });
      page.on('request', (request) => {
        const pathname = new URL(request.url()).pathname;
        if (finalApprovalSucceeded && request.method() === 'GET' && pathname === `${apiVersionPath}/findings`)
          readyFindingsRequests.add(request);
        if (
          finalApprovalSucceeded &&
          request.method() === 'POST' &&
          pathname.startsWith(`${apiVersionPath}/lanes/`) &&
          pathname.endsWith('/qc-run')
        )
          qcPostsAfterReady.push(pathname);
      });
      const expectReadyReadOnly = async (
        priorFindingsGets: number,
        presentation: 'it-empty' | 'owner-findings',
      ) => {
        await expect.poll(() => readyFindingsGets).toBeGreaterThan(priorFindingsGets);
        await expect(page.locator('[data-status="ready_for_launch"]').first()).toBeVisible();
        await expect(page.locator('[data-review-qc="loading"]')).toHaveCount(0);
        if (presentation === 'it-empty') {
          const workspace = page.locator('.reviewer-workspace');
          await expect(workspace.getByRole('heading')).toHaveText(
            t('th', 'review.findings.heading', { lane: label('lane.it_security') }),
          );
          await expect(workspace.locator('[data-review-qc="empty"]')).toBeVisible();
          await expect(workspace.locator('[data-review-qc="empty"]')).toHaveText(
            label('review.findings.empty'),
          );
          await expect(workspace.locator('[data-finding-id]')).toHaveCount(0);
        } else {
          await expect(
            page.locator(`[data-finding-id="${findingId}"] [data-disposition-kind="fixed_confirmed"]`),
          ).toBeVisible();
          await expect(page.locator(`[data-finding-id="${findingId}"]`)).toContainText(
            t('th', 'review.findings.slot', { number: 1, name: label('slot.s1.name') }),
          );
        }
        await expect(page.getByRole('alert')).toHaveCount(0);
        await expect(page.locator('[data-disposition-kind-action]')).toHaveCount(0);
        await expect(button(page, 'review.action.approve')).toHaveCount(0);
        await expect(button(page, 'review.action.send_back')).toHaveCount(0);
        expect(qcPostsAfterReady).toEqual([]);
      };
      for (const [user, lane, ready] of [
        ['fx-user-dpo', 'dpo', false],
        ['fx-user-ai-coe', 'ai_coe', false],
        ['fx-user-it-security', 'it_security', true],
      ] as const) {
        await signOut(page);
        await signIn(page, origin, user, versionPath);
        await expect(page.locator('[data-review-controls="ready"]')).toBeVisible();
        await expect(page.locator('[data-review-qc="loading"]')).toHaveCount(0);
        await expectMainFocused(page);
        const decision = page.waitForResponse(
          (r) => r.request().method() === 'POST' && r.url().endsWith(`/lanes/${lane}/approve`),
        );
        await activate(page, button(page, 'review.action.approve'));
        const response = await decision;
        expect(response.status()).toBe(201);
        expect(((await response.json()) as { ready: boolean }).ready).toBe(ready);
      }
      await expect(page.locator('[data-status="ready_for_launch"]').first()).toBeVisible();
      expect(finalApprovalSucceeded).toBe(true);
      await expectReadyReadOnly(0, 'it-empty');
      await expectAccessible(page, info, { name: 'combined-ready-th', lang: 'th' });
      await expect
        .poll(async () =>
          (await mails(env.MAIL_SINK_DIR!)).some(
            (m) => m.event.kind === 'ready_for_launch' && m.event.versionId === v2,
          ),
        )
        .toBe(true);
      const delivered = (await mails(env.MAIL_SINK_DIR!)).filter((m) => m.event.caseId === caseId);
      expect(delivered).toHaveLength(10); // four lane notices per version, one send-back, one Ready
      expect(new Set(delivered.map((mail) => mail.dedupKey)).size).toBe(10);
      for (const mail of delivered) {
        expect(mail.event.kind).not.toBe('sla_breach_digest');
        await expect
          .poll(
            async () =>
              (
                await db.query<{ status: string; attempts: number; id: string }>(
                  'SELECT n.status, n.attempts, a.id FROM notification n JOIN audit_event a ON a.id = $1 AND a.correlation_id = n.correlation_id AND a.target_case_id = n.case_id AND a.target_version_id = n.version_id WHERE n.recipient = $2 AND n.version_id = $3 AND n.lane = $4 AND n.event = $5',
                  [
                    mail.event.auditEventId,
                    mail.recipient.address,
                    mail.event.versionId,
                    mail.event.lane ?? '-',
                    NOTIFICATION_EVENT_BY_KIND[mail.event.kind],
                  ],
                )
              ).rows,
          )
          .toEqual([{ status: 'sent', attempts: 1, id: mail.event.auditEventId }]);
        expect(mail.mail.textBody).toContain(mail.deepLinks[0]!.url);
      }
      await signOut(page);
      const readyMail = delivered.find((m) => m.event.kind === 'ready_for_launch')!;
      expect(readyMail.recipient.recipientId).toBe('fixture:fx-user-owner-cm');
      const priorFindingsGets = readyFindingsGets;
      await signIn(page, origin, 'fx-user-owner-cm', new URL(readyMail.deepLinks[0]!.url).pathname);
      await expectReadyReadOnly(priorFindingsGets, 'owner-findings');
      await expect(page.locator('[data-status="ready_for_launch"]').first()).toBeVisible();
      await activate(page, page.getByRole('link', { name: label('queue.title'), exact: true }));
      await expect(page.getByTestId('queue-count')).toBeVisible();
      await expectMainFocused(page);
      await type(page, page.getByLabel(label('queue.search'), { exact: true }), name);
      await activate(page, button(page, 'queue.apply'));
      await expect(card).toHaveCount(1);
      await expect(card).toContainText(label('queue.next.review_complete'));
      expect(((await (await page.request.get(versionUrl)).json()) as SubmittedVersion).slots).toEqual(
        parsed.slots,
      );
      await expect(page.getByRole('button', { name: /deploy|เปิดใช้/i })).toHaveCount(0);
      expect(qcPostsAfterReady).toEqual([]);
      const video = page.video();
      await page.close();
      if (video)
        await info.attach('w3-int-keyboard-walkthrough', {
          path: await video.path(),
          contentType: 'video/webm',
        });
    } finally {
      await server.stop();
      await db.end();
    }
  });
});
