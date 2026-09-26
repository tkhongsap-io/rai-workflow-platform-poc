# Review: one Thai term for desk completion (W3-F5, #167)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Decision implemented: register row "W3 deferred rulings", status name (Ta, 2026-09-26). Synthetic data only.

## Change

- `shared/src/locales/th.json`, six values now use "การตรวจทานในระบบเสร็จสิ้น":
  - the status badge (`status.ready_for_launch`, which was English);
  - the next action;
  - the decided-Ready message;
  - the stale-version guidance;
  - the Ready mail subject and body. The Thai mail drops its "(Ready for launch)" suffix, so it reads like the badge.
- The queue next action and the operator value already used the term. `en.json` is unchanged.
- `web/src/i18n/desk-complete-term.test.ts` (new) pins every surface and the unchanged English.
- `tests/browser/w3-int-02-queue.spec.ts`: on a Ready card the badge and the next-action line now read the same Thai text, so the check matches the whole next-action line ("ขั้นตอนถัดไป: …") instead of the bare term.

## Worth Ta's eye (no change made)

On a Ready queue card and on My cases, Thai now shows the same words twice: the badge, then "ขั้นตอนถัดไป: การตรวจทานในระบบเสร็จสิ้น". This follows directly from the ruling, which covers the badge and every surface. English differs ("Ready for launch" / "Desk review complete") because English is outside the ruling. If the repetition reads badly, a later wording change to the next action is Ta's call.

## Commands and results

Worktree `/tmp/rai-f5`, Postgres `rai-f3` on 55373, one suite at a time.

| Command (from `rai-web/` unless noted) | Result |
|---|---|
| RED: `desk-complete-term.test.ts` before the change | failed: `status.ready_for_launch: Ready for launch` |
| `npm run lint`, `npm run typecheck` | exit 0 |
| `npm run test:unit` | 592/592 |
| `npm run test:integration` | 334/334, 0 skipped |
| `npm run build && npm run check:substitute-absent` | 607 files, 0 markers |
| `npm run test:browser:server` (first run) | 193 passed, 3 failed: the queue review-complete test at all three widths, a strict-mode double match (see Change) |
| queue spec rerun after the locator fix (`playwright test -c tests/browser/playwright.config.ts tests/browser/w3-int-02-queue.spec.ts`) | 33 passed, including the axe audits in th |
| `npm run test:browser:substitute` | 48 passed |
| `npm run test:browser:server` (full rerun at fd3ce94) | 196 passed (7.7m) |
| `node scripts/check-links.mjs` (root) | 0 broken |


Round 2 changes one Thai sentence (`review.decided.ready`) and the W0-06 8.5 table. Rerun after it: unit 592/592; build exit 0; the two specs that show the decided-Ready message (`w2-int-journey`, `w2-int-09-disposition`) 12 passed; links 0 broken.

## Review verdicts

| Round | Head | Reviewer | Verdict | Notes acted on |
|---|---|---|---|---|
| 1 | fd3ce94 | contract | PASS | `review.decided.ready` now reads "เคสนี้อยู่ในสถานะการตรวจทานในระบบเสร็จสิ้นแล้ว", matching the stale-version sentence. The W0-06 8.5 table shows the new Thai values. Not taken: quoting the term inside the sentence. |
| 1 | fd3ce94 | correctness | PASS | Full browser rerun recorded above. Deferred: the English half of the new test restates four `en.json` values by design. |
