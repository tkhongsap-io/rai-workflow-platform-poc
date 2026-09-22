# Review: W2 exit — parallel reviews, send-back and completion (Milestone M2)

2026-09-22. Ticket W2-08 (issue #41), lane Lead, owner type Human; the record is written by the delegated ticket flow (D03 amendment) for Ta's review. Branch `codex/w2-08-w2-exit`, checkout `/Users/tkhongsap/github/rai-workflow-platform-poc`, base `origin/main` at `2f919eb` (W2-INT merged; every other W2 ticket — W2-01 to W2-07, W2-09, W2-10, W2-INT — merged before this record started). Postgres is the existing harness on `127.0.0.1:54351` (`rai-w2-01-postgres-1`, Healthy); no new database was created, `.env` was not edited, and nothing was dropped. Proves A04, A07, A09 and A11 for the package exit. This ticket writes no product code: it runs the W2-INT suite and the exit checks from this checkout, records command, output and fixture identity, and flips the W2/M2 gates. No decision is recorded or resolved; D01–D12 untouched; the frozen source spec untouched. Issue #35 stays open. Epic #53 is not closed by this record.

**Fixture set: `fixture set slice1-synthetic@1 7c80ccd43663`** — the identity every W2-INT browser describe and the negatives suite print (`rai-web/fixtures/src/data/manifest.json`; provenance and per-fixture identities in [rai-web/fixtures/src/data/README.md](../../rai-web/fixtures/src/data/README.md)). Fixture identities used by the suite: users `fx-user-owner-cm`, `fx-user-dpo`, `fx-user-ai-coe`, `fx-user-it-security`, `fx-user-admin`, `fx-user-dpo-spoc-hr`; cases `fx-case-nonvendor` (RAI-2000-0001, CM), `fx-case-hr-dualrole` (RAI-2000-0005, HR).

This record holds (1) the environment, (2) the automated suites with their exact output, (3) the A-ID evidence table against the W2 exit clauses, (4) known limitations, (5) the gate changes this commit makes and (6) tracker notes.

## 1. Environment

| Item | Value |
|---|---|
| Node / npm | v24.21.0 / 11.19.0 (`export PATH=$HOME/.nvm/versions/node/v24.21.0/bin:$PATH`) |
| Postgres | Existing harness `rai-w2-01-postgres-1` on `127.0.0.1:54351` (Healthy); `DATABASE_URL` / `DATABASE_MIGRATE_URL` already point here in the local `rai-web/.env` — not edited |
| Checkout | `git checkout -B codex/w2-08-w2-exit 2f919eb`; status clean of product changes before the first command (`.superpowers/` untracked and never staged) |
| Playwright | Chromium already installed on this machine; no install step was needed |
| Shell | zsh; every command below run from `rai-web/` |

## 2. Automated suites — commands and exact output

All from `rai-web/` on the checkout above, each exit 0.

### 2.1 `npm run lint`

```text
$ npm run lint

> @rai/root@0.0.0 lint
> eslint . && prettier --check . && node scripts/check-css.mjs

Checking formatting...
All matched files use Prettier code style!
check-css: no outline removal outside :focus-visible
```

(`eslint .` silent; exit 0.)

### 2.2 `npm run typecheck`

```text
$ npm run typecheck

> @rai/root@0.0.0 typecheck
> tsc -b
```

(exit 0; `tsc -b` silent.)

### 2.3 W2-INT evidence Playwright specs

```text
$ npx playwright test -c tests/browser/playwright.config.ts w2-int-journey.spec.ts w2-int-07-reviewer-workspace.spec.ts w2-int-09-disposition.spec.ts
[WebServer] [plugin builtin:vite-reporter] 
[WebServer] (!) Some chunks are larger than 500 kB after minification. Consider:
[WebServer] - Using dynamic import() to code-split the application
[WebServer] - Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
[WebServer] - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.

Running 15 tests using 1 worker

(node:46397) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
  ✓   1 [desktop-1440] › tests/browser/w2-int-07-reviewer-workspace.spec.ts:79:3 › W2-INT reviewer workspace on the real server (fixture set slice1-synthetic@1 7c80ccd43663; fx-case-nonvendor) › keyboard send-back: findings before controls, dialog focus, frozen N unchanged, axe th+en (2.1s)
  ✓   2 [desktop-1440] › tests/browser/w2-int-07-reviewer-workspace.spec.ts:221:3 › W2-INT reviewer workspace on the real server (fixture set slice1-synthetic@1 7c80ccd43663; fx-case-nonvendor) › keyboard approve records the notice and sends qcRunId (1.2s)
  ✓   3 [desktop-1440] › tests/browser/w2-int-09-disposition.spec.ts:68:3 › W2-INT disposition UI on the real server (fixture set slice1-synthetic@1 7c80ccd43663; fx-case-nonvendor) › keyboard: owner propose-fixed then AI/COE confirm; axe on owner findings (1.4s)
  ✓   4 [desktop-1440] › tests/browser/w2-int-09-disposition.spec.ts:119:3 › W2-INT disposition UI on the real server (fixture set slice1-synthetic@1 7c80ccd43663; fx-case-nonvendor) › keyboard N/A and waive kinds; empty reason stays; admin has no controls (882ms)
  ✓   5 [desktop-1440] › tests/browser/w2-int-journey.spec.ts:94:3 › W2-INT journey on the real server: v1 → send-back → v2 → dispositions → three approvals → Ready (fixture set slice1-synthetic@1 7c80ccd43663; fx-case-nonvendor) › owner submits; AI/COE send-back names a slot; owner resubmits v2; dispose then three approvals reach Ready (3.8s)
(node:46587) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
  ✓   6 [tablet-834] › tests/browser/w2-int-07-reviewer-workspace.spec.ts:79:3 › W2-INT reviewer workspace on the real server (fixture set slice1-synthetic@1 7c80ccd43663; fx-case-nonvendor) › keyboard send-back: findings before controls, dialog focus, frozen N unchanged, axe th+en (1.9s)
  ✓   7 [tablet-834] › tests/browser/w2-int-07-reviewer-workspace.spec.ts:221:3 › W2-INT reviewer workspace on the real server (fixture set slice1-synthetic@1 7c80ccd43663; fx-case-nonvendor) › keyboard approve records the notice and sends qcRunId (1.1s)
  ✓   8 [tablet-834] › tests/browser/w2-int-09-disposition.spec.ts:68:3 › W2-INT disposition UI on the real server (fixture set slice1-synthetic@1 7c80ccd43663; fx-case-nonvendor) › keyboard: owner propose-fixed then AI/COE confirm; axe on owner findings (1.1s)
  ✓   9 [tablet-834] › tests/browser/w2-int-09-disposition.spec.ts:119:3 › W2-INT disposition UI on the real server (fixture set slice1-synthetic@1 7c80ccd43663; fx-case-nonvendor) › keyboard N/A and waive kinds; empty reason stays; admin has no controls (897ms)
  ✓  10 [tablet-834] › tests/browser/w2-int-journey.spec.ts:94:3 › W2-INT journey on the real server: v1 → send-back → v2 → dispositions → three approvals → Ready (fixture set slice1-synthetic@1 7c80ccd43663; fx-case-nonvendor) › owner submits; AI/COE send-back names a slot; owner resubmits v2; dispose then three approvals reach Ready (3.9s)
(node:46853) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
  ✓  11 [phone-390] › tests/browser/w2-int-07-reviewer-workspace.spec.ts:79:3 › W2-INT reviewer workspace on the real server (fixture set slice1-synthetic@1 7c80ccd43663; fx-case-nonvendor) › keyboard send-back: findings before controls, dialog focus, frozen N unchanged, axe th+en (1.9s)
  ✓  12 [phone-390] › tests/browser/w2-int-07-reviewer-workspace.spec.ts:221:3 › W2-INT reviewer workspace on the real server (fixture set slice1-synthetic@1 7c80ccd43663; fx-case-nonvendor) › keyboard approve records the notice and sends qcRunId (1.2s)
  ✓  13 [phone-390] › tests/browser/w2-int-09-disposition.spec.ts:68:3 › W2-INT disposition UI on the real server (fixture set slice1-synthetic@1 7c80ccd43663; fx-case-nonvendor) › keyboard: owner propose-fixed then AI/COE confirm; axe on owner findings (1.1s)
  ✓  14 [phone-390] › tests/browser/w2-int-09-disposition.spec.ts:119:3 › W2-INT disposition UI on the real server (fixture set slice1-synthetic@1 7c80ccd43663; fx-case-nonvendor) › keyboard N/A and waive kinds; empty reason stays; admin has no controls (877ms)
  ✓  15 [phone-390] › tests/browser/w2-int-journey.spec.ts:94:3 › W2-INT journey on the real server: v1 → send-back → v2 → dispositions → three approvals → Ready (fixture set slice1-synthetic@1 7c80ccd43663; fx-case-nonvendor) › owner submits; AI/COE send-back names a slot; owner resubmits v2; dispose then three approvals reach Ready (3.9s)

  15 passed (31.0s)
```

**15 passed** across desktop-1440, tablet-834 and phone-390 (5 tests × 3 widths). Fixture identity on every describe: `fixture set slice1-synthetic@1 7c80ccd43663`.

**Journey (verbatim title):** `W2-INT journey on the real server: v1 → send-back → v2 → dispositions → three approvals → Ready` — owner submits v1 of `fx-case-nonvendor`; one AI/COE send-back naming a slot; owner resubmits v2 (three lanes open again); owner proposes fixed and owning lane confirms so an undispositioned finding does not block Ready; three current-version approvals; Ready after disposition (`ready: true` on the last approve, `desk_status` / `ai_readiness_status` `ready`, `pack_version.ready_at` set). No Deploy control. No `POST /ready` (404).

### 2.4 W2-INT negatives

```text
$ NODE_ENV=test RAI_IDENTITY_MODE=fixture node --import tsx --conditions=rai-source --test --test-concurrency=1 tests/integration/w2-int-negatives.test.ts
▶ W2-INT exit negatives over HTTP against the real server process — fixture set slice1-synthetic@1 7c80ccd43663
  ✔ two concurrent send-backs yield one successor draft; both decisions recorded; N stays readable (704.867209ms)
  ✔ a stale approval of a superseded version is 409 and changes nothing (453.292792ms)
  ✔ an undispositioned single-lane finding blocks Ready (486.630584ms)
  ✔ Admin cannot approve a lane (403) and writes nothing (413.96425ms)
  ✔ the case owner cannot approve a lane on their own case (403) and writes nothing (437.019208ms)
  ✔ a reviewer who is the BU SPOC of the case cannot approve that lane (403) (430.238583ms)
✔ W2-INT exit negatives over HTTP against the real server process — fixture set slice1-synthetic@1 7c80ccd43663 (3446.23275ms)
ℹ tests 6
ℹ suites 1
ℹ pass 6
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3791.648833
```

**6 passed / 0 failed.** Negatives covered: concurrent send-back → one draft; stale approval → 409 `version_superseded`; undispositioned finding blocks Ready; Admin 403; owner 403; BU SPOC self-approval 403.

### 2.5 Substitute absent from the build

A build was already present (`web/dist`, `server/dist`); no rebuild was required.

```text
$ npm run check:substitute-absent

> @rai/root@0.0.0 check:substitute-absent
> node scripts/check-substitute-absent.mjs

check-substitute-absent: scanned 544 files, 0 with the marker
```

## 3. A-ID evidence table

The W2 exit evidence, clause by clause, as [BUILD_PLAN W2](../../BUILD_PLAN.md#w2--parallel-reviews-send-back-and-completion) and the [work breakdown](../../docs/delivery/slice-1-work-breakdown.md) state it. Every test named ran green in section 2.

| Clause | A-ID | Automated evidence (file › test) | This record |
|---|---|---|---|
| Submit v1 → one send-back → edit/resubmit v2 → three current-version approvals → Ready | A04, A07, A09 | `w2-int-journey.spec.ts` › `owner submits; AI/COE send-back names a slot; owner resubmits v2; dispose then three approvals reach Ready` (×3 widths) | 2.3: Ready after disposition; v1 still readable |
| Concurrent send-backs share one successor draft; N stays readable | A07 | `w2-int-negatives.test.ts` › `two concurrent send-backs yield one successor draft; both decisions recorded; N stays readable` | 2.4 |
| Stale approval of a superseded version fails and writes nothing | A07 | `w2-int-negatives.test.ts` › `a stale approval of a superseded version is 409 and changes nothing` | 2.4 |
| Undispositioned synthetic finding blocks Ready | A09 | `w2-int-negatives.test.ts` › `an undispositioned single-lane finding blocks Ready` | 2.4 |
| Admin cannot approve without lane authority | A01/A04 (D05) | `w2-int-negatives.test.ts` › `Admin cannot approve a lane (403) and writes nothing` | 2.4 |
| Owner cannot approve own case; BU SPOC cannot approve that lane (D05 self-exclusion) | A01/A04 (D05) | `w2-int-negatives.test.ts` › `the case owner cannot approve… (403)…`, › `a reviewer who is the BU SPOC of the case cannot approve that lane (403)` | 2.4 |
| Reviewer workspace and disposition UI on the real server | A09 | `w2-int-07-reviewer-workspace.spec.ts` (send-back + approve); `w2-int-09-disposition.spec.ts` (propose/confirm, N/A, waive) | 2.3: 12 of the 15 browser tests |
| A11: journey reconstructable from audit; UPDATE/DELETE on `audit_event` refused | A11 | `w1-00-audit.test.ts` › `a direct SQL UPDATE or DELETE on audit_event is rejected as rai_app (grant) and as rai_owner (trigger)`; journey reconstruction from the W2-INT audit trail (no new audit subsystem) | See §3.1 |
| Record the command, output and fixture identity | — | sections 1–2; fixture set `slice1-synthetic@1 7c80ccd43663` on every suite title | — |

### 3.1 A11

- **Immutability of audit rows:** `tests/integration/w1-00-audit.test.ts` proves a direct SQL `UPDATE` or `DELETE` on `audit_event` fails for `rai_app` (missing grant) and for `rai_owner` (append-only trigger). This exit does not add an audit subsystem.
- **Reconstruction:** the W2 journey's audit events are the reconstruction. The journey already asserts the audit action `lane.opened` (three lanes on the resubmitted version via `SELECT … FROM audit_event WHERE action = 'lane.opened' …`). The negatives do not assert additional audit action strings; they prove the concurrency, Ready and D05 negatives over HTTP and table state.

## 4. Known limitations — what W2 does not claim

- **QC is the slice-1 substitute stand-in.** Findings come from the W1-10 ScriptedQcRunner bound at the integration layer (`QC_MODE=substitute`). **Do not label QC as implemented.** Real QC is W4. Issue #35 stays open (slot 5, slot 9, pack-level and unavailable owning-lane cases named in its done-when).
- **Google loopback sign-in remains the W1 pending item** (TESTING.md runbook; "Google sign-in on loopback: pending Ta"). It is not a W2 blocker.
- **W4–W8 stay unauthorized** (D07–D10 still open). M3 (W3) is unblocked by this exit; it is next.
- **No mail delivery, no operator queue.** Notification rows may be written; the W1-11 mail sink and W3 queue/SLA remain later packages. Substitute browser runs are never evidence.
- **Synthetic data only.** Same fixture set as W1; no real case or personal data. D08 stays open.
- **Single-lane findings only** in this exit suite. Slot 5 / 9 / pack-level / unavailable owning-lane dispositions are out of scope here.
- **CI is the evidence of record for the repository; this record is one local run** on 2026-09-22 against `2f919eb`.

## 5. Gate changes, documents and checks after them

| Document | Change |
|---|---|
| `changes/2026-09-22-w2-exit/review.md` | this record |
| `BUILD_PLAN.md` | status table cells only (dated 2026-09-22 after the W2 exit): W2 → exit recorded; M2 → Reached; M3 → unblocked, next is W3; W4–W8 not authorized; closing paragraph no longer says the next action is W0-01. Package definitions above the table unchanged |
| `DEVLOG.md` | short M2 / W2 exit entry near the top |
| `docs/board/lane-a-workflow-server.md` | CLAIM + done entry for this session |

Nothing under `rai-web/` product source changed; the suites in section 2 stand as run.

## 6. Tracker notes (for the later PR; not executed by this commit)

- Issue #41 (W2-08): close when the PR that lands this record merges (`Closes #41`).
- Issue #35: stays open (slot 5, slot 9, pack-level and unavailable owning-lane cases named in its done-when).
- Epic #53 (W2): remains open after this record; a comment linking this record when the PR opens is enough for the exit evidence.
- W3 issues / epic: become ready after Ta accepts this exit; not flipped by this commit alone.
- No D01–D12 rows are recorded or resolved here.
