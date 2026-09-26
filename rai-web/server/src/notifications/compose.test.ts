import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CommittedEvent } from '@rai/shared/mail/types';
import type { SendBackFeedback } from '@rai/shared/schemas/review';
import {
  composeCaseMail,
  resolveRecipient,
  safeBaseUrl,
  versionLink,
  CompositionError,
  type MailIdentity,
} from './compose.js';

const base = new URL('http://127.0.0.1:8787');
const facts = { caseId: 'case-1', ownerSubjectId: 'owner', businessUnitId: 'CM' };
const users: MailIdentity[] = [
  {
    subjectId: 'owner',
    email: 'owner@rai-desk.example',
    displayName: 'Synthetic owner',
    roles: [{ role: 'owner', scope: { kind: 'own_cases' } }],
  },
  {
    subjectId: 'dpo',
    email: 'dpo@rai-desk.example',
    displayName: 'Synthetic DPO',
    roles: [{ role: 'dpo', scope: { kind: 'all_cases', lane: 'dpo' } }],
  },
  {
    subjectId: 'spoc',
    email: 'spoc@rai-desk.example',
    displayName: 'Synthetic SPOC',
    roles: [{ role: 'bu_spoc', scope: { kind: 'business_unit', businessUnit: 'CM' } }],
  },
];
const event: CommittedEvent = {
  kind: 'lane_opened',
  caseId: 'case-1',
  versionId: 'version-1',
  versionNumber: 1,
  lane: 'dpo',
  digestDay: null,
  auditEventId: 'audit-1',
  correlationId: 'correlation-1',
  committedAt: '2026-09-22T00:00:00Z',
};
const feedback = {
  items: [{ slot: 2, deficiency: 'Please clarify the basis.' }],
  summary: 'ชี้แจงข้อมูลเพิ่มเติม',
} as SendBackFeedback;

for (const locale of ['th', 'en'] as const) {
  for (const kind of ['lane_opened', 'sent_back', 'ready_for_launch'] as const) {
    test(`${locale} ${kind}: source contents, safe link and locale keys`, () => {
      const e = { ...event, kind, lane: kind === 'ready_for_launch' ? null : event.lane };
      const recipient = resolveRecipient(
        users,
        kind === 'lane_opened' ? users[1]!.email : users[0]!.email,
        e,
        facts,
      );
      recipient.locale = locale;
      const req = composeCaseMail(
        e,
        recipient,
        { caseName: 'เคสสังเคราะห์', findingCount: 3, dueOn: '2026-09-25', feedback },
        base,
      );
      assert.equal(req.mail.templateKey, `mail.${kind}`);
      assert.ok(req.mail.textBody.includes(req.deepLinks[0]!.url));
      assert.ok(req.mail.textBody.includes('เคสสังเคราะห์'));
      assert.doesNotMatch(req.mail.textBody, /\{\w+\}/);
      assert.equal(req.deepLinks[0]!.requiresSignIn, true);
      assert.equal(new URL(req.deepLinks[0]!.url).search, '');
      if (locale === 'th') assert.match(req.mail.subject, /[ก-๙]/);
      if (kind === 'lane_opened') {
        assert.equal(req.mail.templateParams.findingCount, 3);
        assert.match(String(req.mail.templateParams.dueDate), /2026/);
        assert.doesNotMatch(String(req.mail.templateParams.dueDate), /2569/);
        if (locale === 'th') assert.equal(req.mail.templateParams.dueDate, '25 กันยายน ค.ศ. 2026');
        assert.ok(req.mail.templateParams.laneLabel);
      }
      if (kind === 'sent_back') assert.equal(req.mail.templateParams.feedback, feedback.summary);
      // W3-F4 (ruling item 12): the owner's send-back link opens the case, where the successor draft and its
      // feedback are; lane-opened and Ready links still open the decided version.
      const url = new URL(req.deepLinks[0]!.url);
      if (kind === 'sent_back') {
        assert.equal(req.deepLinks[0]!.route, 'case');
        assert.equal(url.pathname, `/cases/${e.caseId}`);
      } else {
        assert.equal(req.deepLinks[0]!.route, 'case_version');
        assert.equal(url.pathname, `/cases/${e.caseId}/versions/${e.versionId}`);
      }
      assert.equal(req.mail.templateParams.caseLink, req.deepLinks[0]!.url);
      assert.equal(req.attempt, 1);
    });
  }
}
test('recipients are event-specific, synthetic and authorized; self-excluded reviewer remains a viewer', () => {
  assert.equal(resolveRecipient(users, users[1]!.email, event, facts).locale, 'th');
  for (const address of [users[0]!.email, users[2]!.email, 'unknown@rai-desk.example'])
    assert.throws(() => resolveRecipient(users, address, event, facts), CompositionError);
  const e = { ...event, kind: 'sent_back' as const };
  assert.throws(() => resolveRecipient(users, users[2]!.email, e, facts), CompositionError);
  assert.throws(
    () =>
      resolveRecipient(
        [{ ...users[1]!, email: 'person@real-mail.com' }],
        'person@real-mail.com',
        event,
        facts,
      ),
    CompositionError,
  );
  const otherOwner = { ...users[0]!, subjectId: 'other-owner' };
  assert.throws(() => resolveRecipient([otherOwner], otherOwner.email, e, facts), CompositionError);
  assert.equal(
    resolveRecipient(users, users[1]!.email, event, { ...facts, ownerSubjectId: 'dpo' }).recipientId,
    'dpo',
  );
});
test('unsafe base and path data fail closed; templates cannot inject a URL', () => {
  assert.ok(safeBaseUrl(base));
  for (const url of [
    'http://user:secret@127.0.0.1',
    'http://127.0.0.1/path',
    'http://127.0.0.1?token=x',
    'http://127.0.0.1/#fragment',
    'file:///',
  ]) {
    assert.equal(safeBaseUrl(new URL(url)), false, url);
    assert.throws(() => versionLink(new URL(url), 'c', 'v'), CompositionError);
  }
  for (const id of ['../evil', 'c?token=1', 'c#fragment', 'c/elsewhere'])
    assert.throws(() => versionLink(base, id, 'v'), CompositionError);
});
test('feedback is capped at 500 code units and uses named artifact feedback when summary absent', () => {
  const e = { ...event, kind: 'sent_back' as const };
  const recipient = resolveRecipient(users, users[0]!.email, e, facts);
  const render = (f: SendBackFeedback) =>
    composeCaseMail(e, recipient, { caseName: 'case', feedback: f }, base);
  assert.equal(
    String(render({ ...feedback, summary: 'ก'.repeat(900) }).mail.templateParams.feedback).length,
    500,
  );
  assert.match(String(render({ items: feedback.items }).mail.templateParams.feedback), /2: Please clarify/);
});
test('digest, incomplete event and missing SLA facts are refused', () => {
  const recipient = resolveRecipient(users, users[1]!.email, event, facts);
  for (const e of [
    { ...event, auditEventId: '' },
    { ...event, kind: 'sla_breach_digest' as const },
  ])
    assert.throws(() => composeCaseMail(e, recipient, { caseName: 'case' }, base), CompositionError);
  assert.throws(() => composeCaseMail(event, recipient, { caseName: 'case' }, base), CompositionError);
});
