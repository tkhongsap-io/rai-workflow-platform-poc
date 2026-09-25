# W2-05 owning-lane rule: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the #35 owning-lane rule Ta accepted on 2026-09-25 and make the workflow store, own and gate every finding category it left open, so W2-05's done-when is met in full and a QC outage can no longer be followed by Ready without a person's disposition.

**Architecture:** One rule function in `@rai/shared/constants` replaces `owningLaneForSlot`; the shared validator enforces it with the run's lane; the orchestrator builds the W0-07 3.6 `QC-UNAVAILABLE` finding once per open scope; the W1-10 substitute accepts the two formerly reserved finding shapes. No migration. Docs and the register are changed in the same PR, as W0-06 7.3 prescribes.

**Tech Stack:** TypeScript on Node 24, Fastify, Drizzle on Postgres 16, node:test, Playwright. Every npm command runs from `rai-web/`.

**Spec:** [spec.md](spec.md) (this folder); the decision brief is [issue-35-decision-brief.md](../2026-09-23-w3-hardening/issue-35-decision-brief.md).

## Global constraints

- Branch `codex/w2-05-owning-lane`, own worktree, own Postgres (compose project `rai-w2-05`, `POSTGRES_PORT=55370`, checked free on 2026-09-25). Never connect to, migrate or modify a Postgres container you did not start.
- Synthetic data only. No document text, filename or PII in any log line, finding, fixture or test name.
- Every user-facing string is a locale key present in both `shared/src/locales/th.json` and `en.json` (D12).
- No test weakened. A test that changes expectation says why in a comment that cites the spec line.
- Two independent reviewer agents post verdicts on the PR; CI green on the reviewed head; then the D03 ticket flow merges.
- Agents never record a decision: the register row (Task 8) is Ta's wording, approved in chat before the PR is opened.

## Review focus

Inputs the spec implies but no task's tests exercised at first draft, most likely to bite first. Each now has a test in the task named.

1. **Two outages in a row on the same lane before anyone acts** must produce two `qc_run` rows and one finding (Task 5, "dedup").
2. **An outage after the owning lane already waived the previous one** must produce a new open finding, so a waived outage does not cover a later one (Task 5, "after waiver").
3. **A runner that names the right lane for slot 5 on a submit run but the wrong lane on an approve-attempt run** must be refused on the approve attempt only (Task 2, `finding_outside_lane`).
4. **An `unavailable` finding on version N after a send-back** must not appear on N+1 and must stay readable on N (Task 6, "not carried").
5. **The reviewer workspace during an outage** must show the finding row with disposition controls for the owning lane, under the existing unavailable notice, so the lane can act from the screen it decides on (Task 7).

---

### Task 0: Worktree, database, claim

**Files:**
- Modify: `docs/board/lane-b-ui-notifications.md` (append only)

- [ ] **Step 1: Isolated worktree.** Use `superpowers:using-git-worktrees`. Branch `codex/w2-05-owning-lane` from `origin/main`, worktree at `/tmp/rai-w2-05`.
- [ ] **Step 2: Database and env.** In `/tmp/rai-w2-05/rai-web`: `npm ci`; `POSTGRES_PORT=55370 docker compose -p rai-w2-05 up -d --wait`; `cp .env.example .env`; in `.env` replace every `54320` with `55370`, set `RAI_IDENTITY_MODE=fixture`, `PORT=8770`, `PUBLIC_BASE_URL=http://127.0.0.1:8770`, `PLAYWRIGHT_BASE_URL=http://127.0.0.1:58370`, `SUBSTITUTE_PORT=58470`, `SUBSTITUTE_WEB_PORT=58570`; export `DATABASE_OPERATOR_URL` and `OBS_MIGRATION_ADMIN_URL` as CI does (see `TESTING.md`); `npm run migrate`.
- [ ] **Step 3: Baseline.** `npm run test:unit && npm run test:integration` must pass before any change. Record the counts.
- [ ] **Step 4: Claim.** Append to `docs/board/lane-b-ui-notifications.md`:

```text
## 2026-09-25 HH:MM — CLAIM lane-b: W2-05 owning-lane rule (#35)
- Author: operator=ta session=claude-code-w2-05-owning-lane model=claude-fable-5-1
- Takes over from: session=none (reason: new; the ticket was status:ready and blocked on W0-06 7.3)
- Scope: the rule Ta accepted on 2026-09-25, per changes/2026-09-25-w2-05-owning-lane/. One PR.
```

- [ ] **Step 5: Commit** `docs: frame the W2-05 owning-lane change (intent, spec, plan, claim)`.

---

### Task 1: The shared rule

**Files:**
- Modify: `rai-web/shared/src/constants.ts:45-55`
- Test: `rai-web/shared/src/constants.test.ts:44-51`

**Interfaces (produces):**

```ts
export const PACK_OWNING_LANE: Lane = 'ai_coe';
export type OwningLaneRule =
  | { kind: 'lane'; lane: Lane }                       // single-lane slot, or the pack
  | { kind: 'raising_lane'; lanes: readonly Lane[] }   // slot 5: the lane whose rule raised it
  | { kind: 'no_defects' };                            // slot 9: informational only
export function owningLaneRule(scope: { kind: 'pack' } | { kind: 'slot' | 'artifact'; slot: Slot }, mapping: LaneMapping): OwningLaneRule;
export function unavailableOwningLane(run: { trigger: 'approve_attempt'; lane: Lane } | { trigger: 'submit'; lane: null } | { trigger: 'upload'; slot: Slot }, mapping: LaneMapping): Lane;
```

`owningLaneForSlot` is deleted. Its four callers are updated in Tasks 2 and 3.

- [ ] **Step 1: Replace the test** at `constants.test.ts:44-51` with:

```ts
test('owningLaneRule: single-lane slots map (7.1); slot 5 is the raising lane, slot 9 no defects, pack AI/COE (7.3, 2026-09-25)', () => {
  assert.deepEqual(owningLaneRule({ kind: 'slot', slot: 1 }, LANE_MAPPING_V1), { kind: 'lane', lane: 'ai_coe' });
  for (const slot of [2, 3, 4] as const)
    assert.deepEqual(owningLaneRule({ kind: 'slot', slot }, LANE_MAPPING_V1), { kind: 'lane', lane: 'dpo' });
  for (const slot of [6, 7, 8] as const)
    assert.deepEqual(owningLaneRule({ kind: 'artifact', slot }, LANE_MAPPING_V1), { kind: 'lane', lane: 'it_security' });
  assert.deepEqual(owningLaneRule({ kind: 'slot', slot: 5 }, LANE_MAPPING_V1), {
    kind: 'raising_lane',
    lanes: ['ai_coe', 'dpo', 'it_security'],
  });
  assert.deepEqual(owningLaneRule({ kind: 'slot', slot: 9 }, LANE_MAPPING_V1), { kind: 'no_defects' });
  assert.deepEqual(owningLaneRule({ kind: 'pack' }, LANE_MAPPING_V1), { kind: 'lane', lane: PACK_OWNING_LANE });
  assert.equal(PACK_OWNING_LANE, 'ai_coe');
});

test('unavailableOwningLane follows the run (7.3 part 4): approve attempt → its lane; submit → pack owner; upload → the slot lane', () => {
  assert.equal(unavailableOwningLane({ trigger: 'approve_attempt', lane: 'dpo' }, LANE_MAPPING_V1), 'dpo');
  assert.equal(unavailableOwningLane({ trigger: 'submit', lane: null }, LANE_MAPPING_V1), 'ai_coe');
  assert.equal(unavailableOwningLane({ trigger: 'upload', slot: 7 }, LANE_MAPPING_V1), 'it_security');
  // Upload on slot 5 or 9 is defined with upload QC (W4); until then it is a thrown error, never a guess.
  assert.throws(() => unavailableOwningLane({ trigger: 'upload', slot: 5 }, LANE_MAPPING_V1), /upload QC/);
  assert.throws(() => unavailableOwningLane({ trigger: 'upload', slot: 9 }, LANE_MAPPING_V1), /upload QC/);
});
```

Update the import line to `owningLaneRule, unavailableOwningLane, PACK_OWNING_LANE` and drop `owningLaneForSlot`.

- [ ] **Step 2: Run** `npm run test:unit -- --test-name-pattern="owningLaneRule|unavailableOwningLane"` → FAIL (not exported).
- [ ] **Step 3: Implement** in `constants.ts`, replacing lines 45-55:

```ts
/** W0-06 7.3 part 3, recorded 2026-09-25: pack-level findings are AI/COE's. */
export const PACK_OWNING_LANE: Lane = 'ai_coe';

/** W0-06 section 7: who owns a `defect` finding of the given scope under the mapping recorded on its version. */
export type OwningLaneRule =
  | { kind: 'lane'; lane: Lane } // a single-lane slot (7.1), or the pack (7.3 part 3)
  | { kind: 'raising_lane'; lanes: readonly Lane[] } // slot 5: the lane whose rule raised it (7.3 part 1)
  | { kind: 'no_defects' }; // slot 9: informational only, QC raises no defect (7.3 part 2)

export function owningLaneRule(
  scope: { kind: 'pack' } | { kind: 'slot' | 'artifact'; slot: Slot },
  mapping: LaneMapping,
): OwningLaneRule {
  if (scope.kind === 'pack') return { kind: 'lane', lane: PACK_OWNING_LANE };
  const lanes = lanesForSlot(scope.slot, mapping);
  if (lanes.length === 1) return { kind: 'lane', lane: lanes[0]! };
  if (lanes.length === 0) return { kind: 'no_defects' };
  return { kind: 'raising_lane', lanes };
}

/** W0-06 7.3 part 4: a QC-unavailable finding follows the run that saw the outage. */
export function unavailableOwningLane(
  run:
    | { trigger: 'approve_attempt'; lane: Lane }
    | { trigger: 'submit'; lane: null }
    | { trigger: 'upload'; slot: Slot },
  mapping: LaneMapping,
): Lane {
  if (run.trigger === 'approve_attempt') return run.lane;
  if (run.trigger === 'submit') return PACK_OWNING_LANE;
  const rule = owningLaneRule({ kind: 'slot', slot: run.slot }, mapping);
  if (rule.kind === 'lane') return rule.lane;
  throw new Error(`owning lane for an unavailable upload run on slot ${run.slot} is defined with upload QC (W4)`);
}
```

- [ ] **Step 4: Run** the two tests → PASS. `npm run typecheck` will fail on the four old callers; that is expected until Tasks 2-3.
- [ ] **Step 5: Commit** `shared: owningLaneRule and unavailableOwningLane record W0-06 7.3 (#35)`.

---

### Task 2: Enforce the rule at the QC boundary

**Files:**
- Modify: `rai-web/shared/src/qc/validate.ts:150-165, 234-245`
- Modify: `rai-web/fixtures/src/substitutes/api/routes-review.ts:100-116`
- Test: `rai-web/shared/src/qc/validate.test.ts:116-131`

**Interfaces:**
- Consumes: `owningLaneRule` (Task 1).
- Produces: `checkOwningLane(finding: QcFinding, mapping: LaneMapping, runLane: Lane | null): QcFindingViolation | null`. Violations `'owning_lane_slot_informational'` and `'finding_outside_lane'` are added; `'owning_lane_rule_pending'` is removed.

- [ ] **Step 1: Replace the test** at `validate.test.ts:116-131`:

```ts
test('step 5: owning lane per W0-06 7.1 and the 7.3 rule recorded 2026-09-25', () => {
  // single-lane slot (7.1)
  assert.equal(checkOwningLane(finding, LANE_MAPPING_V1, null), null);
  assert.equal(checkOwningLane({ ...finding, owningLane: 'dpo' }, LANE_MAPPING_V1, null), 'owning_lane_mismatch');
  // slot 5: any reviewing lane on submit; on an approve attempt only that run's lane
  const slot5 = { ...finding, scope: { kind: 'slot', slot: 5 } as const };
  assert.equal(checkOwningLane({ ...slot5, owningLane: 'dpo' }, LANE_MAPPING_V1, null), null);
  assert.equal(checkOwningLane({ ...slot5, owningLane: 'dpo' }, LANE_MAPPING_V1, 'dpo'), null);
  assert.equal(checkOwningLane({ ...slot5, owningLane: 'dpo' }, LANE_MAPPING_V1, 'it_security'), 'finding_outside_lane');
  // slot 9: informational only
  assert.equal(
    checkOwningLane({ ...finding, scope: { kind: 'slot', slot: 9 } }, LANE_MAPPING_V1, null),
    'owning_lane_slot_informational',
  );
  // pack: AI/COE
  assert.equal(checkOwningLane({ ...finding, scope: { kind: 'pack' } }, LANE_MAPPING_V1, null), null);
  assert.equal(
    checkOwningLane({ ...finding, scope: { kind: 'pack' }, owningLane: 'dpo' }, LANE_MAPPING_V1, null),
    'owning_lane_mismatch',
  );
  // a single-lane finding on another lane's approve attempt is outside that lane
  assert.equal(checkOwningLane(finding, LANE_MAPPING_V1, 'dpo'), 'finding_outside_lane');
});
```

(`finding` in that file is a slot-1 `ai_coe` finding; keep it.)

- [ ] **Step 2: Run** `npm run test:unit -- --test-name-pattern="step 5"` → FAIL.
- [ ] **Step 3: Implement.** In `validate.ts` replace `'owning_lane_rule_pending'` in the union with `'owning_lane_slot_informational' | 'finding_outside_lane'`, and replace `checkOwningLane`:

```ts
/**
 * Step 5 of W0-07 3.4 under W0-06 section 7 as recorded on 2026-09-25: a single-lane slot and the pack have one
 * lane; slot 5 belongs to the lane whose rule raised it; slot 9 carries no defects. On an approve-attempt run
 * every finding must belong to that run's lane. A run-scoped finding is refused earlier (`run_scope_forbidden`).
 */
export function checkOwningLane(
  finding: QcFinding,
  mapping: LaneMapping,
  runLane: Lane | null,
): QcFindingViolation | null {
  if (finding.scope.kind === 'run') return 'run_scope_forbidden';
  const rule = owningLaneRule(finding.scope, mapping);
  if (rule.kind === 'no_defects') return 'owning_lane_slot_informational';
  if (rule.kind === 'lane' && rule.lane !== finding.owningLane) return 'owning_lane_mismatch';
  if (rule.kind === 'raising_lane' && !rule.lanes.includes(finding.owningLane)) return 'owning_lane_mismatch';
  if (runLane !== null && finding.owningLane !== runLane) return 'finding_outside_lane';
  return null;
}
```

Import `owningLaneRule` instead of `owningLaneForSlot`.

- [ ] **Step 4: Fix the substitute API caller.** In `fixtures/src/substitutes/api/routes-review.ts:100-116` pass the lane and drop the pending skip:

```ts
    const laneCheck = checkOwningLane(finding, mapping, context.lane);
    if (laneCheck !== null) continue;
    out.push(finding);
```

and add `lane: Lane` to that function's `context` parameter type, supplied by its caller (`buildLaneQcRequest` already has `lane`). Remove the `slot === null` / `owningLaneForSlot` lines.

- [ ] **Step 5: Run** `npm run test:unit -- --test-name-pattern="step 5"` → PASS; `npm run typecheck` still fails in `fixtures/src/substitutes/qc/scripts.ts` only (Task 3).
- [ ] **Step 6: Commit** `shared: checkOwningLane enforces the recorded rule with the run's lane`.

---

### Task 3: The substitute accepts the formerly reserved findings

**Files:**
- Modify: `rai-web/fixtures/src/substitutes/qc/scripts.ts:1-12, 81-85, 133-160`
- Modify: `rai-web/fixtures/src/substitutes/qc/scripts/fx-case-missing-slot.json`
- Modify: `rai-web/shared/src/locales/en.json`, `th.json` (one key each)
- Test: `rai-web/fixtures/src/substitutes/qc/scripts.test.ts:26, 200-235`, plus the bundled-script assertions in that file that list rule ids

**Interfaces:** consumes `owningLaneRule`, `PACK_OWNING_LANE` (Task 1). Produces `ScriptedScope` extended with `{ kind: 'pack' }`.

- [ ] **Step 1: Check who drives `fx-case-missing-slot` (RAI-2000-0003) to Ready.** Run `grep -rn "RAI-2000-0003\|fx-case-missing-slot" tests/browser tests/integration ../changes/2026-09-23-w3-hardening/walkthrough-script.md`. Expected from the 2026-09-25 survey: W1-05/W1-04 integration tests and W1-INT-06 browser tests (draft, submit, version navigation; none reaches Ready), and walkthrough step 8 submits it for the queue. If any test reaches Ready on it, it must disposition the two new findings first; record that in the test comment.
- [ ] **Step 2: Rewrite the construction test** at `scripts.test.ts:200-235` so that slot 5 (`owningLane: 'dpo'`) and pack (`owningLane: 'ai_coe'`) **validate**, and these throw with these codes: slot 9 → `scope_slot_9_informational`; pack with `owningLane: 'dpo'` → `owning_lane_mismatch`; slot 5 with `owningLane: 'dpo'` inside an `approve_attempt` entry for lane `it_security` → `finding_outside_lane`; run scope → `scope_run_forbidden`; `QC-UNAVAILABLE` → `qc_unavailable_rule_forbidden`; wrong lane on slot 7 → `owning_lane_mismatch`. Set `RESERVED_RULE_IDS = ['QC-UNAVAILABLE']` and add `'PACK-STAGE-MISMATCH'` to the scripted list at line 20-25.
- [ ] **Step 3: Run** `npm run test:unit -- --test-name-pattern="throws at construction"` → FAIL.
- [ ] **Step 4: Implement** in `scripts.ts`:
  - `ScriptedScope` gains `| { kind: 'pack' }`; `ScriptedEvidence.slot` may be `null` for a pack finding (already typed `SlotNumber | null`).
  - Delete `SINGLE_LANE_SLOTS`. In `validateFinding` replace the block from `if (scope['kind'] === 'pack' || scope['kind'] === 'run')` to the `owning_lane_mismatch` line with:

```ts
  if (scope['kind'] === 'run') fail('scope_run_forbidden', where); // orchestrator-built only (3.6)
  if (scope['kind'] !== 'artifact' && scope['kind'] !== 'slot' && scope['kind'] !== 'pack') fail('scope_invalid', where);
  let typedScope: ScriptedScope;
  if (scope['kind'] === 'pack') {
    typedScope = { kind: 'pack' };
  } else {
    const slot = scope['slot'];
    if (!(SLOTS as readonly unknown[]).includes(slot)) fail('scope_slot_invalid', where);
    if (scope['kind'] === 'artifact') {
      const fixtureArtifactId = scope['fixtureArtifactId'];
      if (typeof fixtureArtifactId !== 'string' || !FIXTURE_DOC_ID.test(fixtureArtifactId))
        fail('fixture_artifact_id_invalid', where);
      if (Number(fixtureArtifactId.slice(-2)) !== slot) fail('fixture_artifact_slot_mismatch', where);
      typedScope = { kind: 'artifact', slot: slot as SlotNumber, fixtureArtifactId };
    } else {
      typedScope = { kind: 'slot', slot: slot as SlotNumber };
    }
  }
  const severity = raw['severity'];
  if (!(SEVERITIES as readonly unknown[]).includes(severity)) fail('severity_invalid', where);
  const owningLane = raw['owningLane'];
  if (!(LANES as readonly unknown[]).includes(owningLane)) fail('owning_lane_invalid', where);
  const mapping = LANE_MAPPINGS_BY_VERSION[script.laneMappingVersion];
  if (mapping === undefined) fail('lane_mapping_version_unknown', where);
  const rule = owningLaneRule(typedScope, mapping);
  if (rule.kind === 'no_defects') fail(`scope_slot_${String(typedScope.kind === 'pack' ? 'pack' : typedScope.slot)}_informational`, where);
  if (rule.kind === 'lane' && rule.lane !== owningLane) fail('owning_lane_mismatch', where);
  if (rule.kind === 'raising_lane' && !rule.lanes.includes(owningLane as Lane)) fail('owning_lane_mismatch', where);
  if (entry.trigger === 'approve_attempt' && entry.lane !== owningLane) fail('finding_outside_lane', where);
```

  - Update the header comment (lines 9-11) to state the recorded rule and that only run scope and `QC-UNAVAILABLE` stay orchestrator-only.
  - Anywhere else in `scripts.ts` or `scripted-runner.ts` that reads `f.scope.slot` for the duplicate-key check (`scripts.ts:243`) use `scopeKeyOf`-style keys: `${f.ruleId}:${f.scope.kind}:${f.scope.kind === 'pack' ? '-' : f.scope.slot}`. In `scripted-runner.ts`, where a scripted scope is turned into a `FindingScope` and evidence resolved, add the `pack` branch (scope `{ kind: 'pack' }`, evidence entries with `slot: null` resolve to `artifactId: null, contentHash: null`). Read that function before editing; keep its shape.
- [ ] **Step 5: Add the two findings** to `fx-case-missing-slot.json`: in the existing `submit` entry append

```json
        {
          "ruleId": "PACK-STAGE-MISMATCH",
          "scope": { "kind": "pack" },
          "severity": "medium",
          "owningLane": "ai_coe",
          "evidence": [{ "slot": null, "locator": { "kind": "absent" } }],
          "measure": null,
          "message": { "key": "qc.finding.pack_stage_mismatch", "params": {} }
        }
```

and add a new entry

```json
    {
      "trigger": "approve_attempt",
      "lane": "dpo",
      "findings": [
        {
          "ruleId": "ACC-METRIC-CITED",
          "scope": { "kind": "slot", "slot": 5 },
          "severity": "medium",
          "owningLane": "dpo",
          "evidence": [{ "slot": 5, "locator": { "kind": "absent" } }],
          "measure": null,
          "message": { "key": "qc.finding.acc_metric_cited", "params": {} }
        }
      ]
    }
```

  Add to `en.json` `"qc.finding.pack_stage_mismatch": "The pack does not match its stage context"` and to `th.json` `"qc.finding.pack_stage_mismatch": "ชุดเอกสารไม่สอดคล้องกับขั้นตอนที่ระบุ"` next to the other `qc.finding.*` keys (alphabetical, as the file is ordered).
- [ ] **Step 6: Run** `npm run test:unit -w fixtures` and `npm run test:unit -w shared` → PASS; `npm run typecheck` → clean. If a fixtures test enumerates every bundled finding (for instance the severity check at `scripts.test.ts:190-198`), it must now see `PACK-STAGE-MISMATCH` as `medium`.
- [ ] **Step 7: Commit** `fixtures: W1-10 scripts carry the recorded slot-5 and pack-level findings; slot 9 refused`.

---

### Task 4: The orchestrator stores the QC-unavailable finding

**Files:**
- Modify: `rai-web/server/src/qc/repository.ts` (add one query)
- Modify: `rai-web/server/src/qc/orchestrator.ts:1-5, 69-74, 182-193, 235-245, 319-344`
- Modify: `rai-web/server/src/db/schema/qc-finding.ts:1` (header comment)
- Test: `rai-web/tests/integration/w2-05-owning-lane.test.ts` (new; Task 5 fills it)

**Interfaces:**
- Consumes: `unavailableOwningLane`, `checkOwningLane(finding, mapping, lane)`.
- Produces:

```ts
// repository.ts
export interface LatestUnavailableFinding { summary: StoredFindingSummary; undispositioned: boolean }
export async function findLatestUnavailableFinding(exec: Executor, versionId: string, trigger: QcTrigger, lane: Lane | null): Promise<LatestUnavailableFinding | undefined>;
// orchestrator.ts
export type PersistQcOutcome =
  | { status: 'completed'; runId: string; findings: StoredFindingSummary[] }
  | { status: 'unavailable'; reason: QcUnavailableReason; runId: string; findings: StoredFindingSummary[] }; // exactly one: the open QC-UNAVAILABLE finding
```

- [ ] **Step 1: Repository query.** Add to `server/src/qc/repository.ts`:

```ts
export interface LatestUnavailableFinding {
  summary: StoredFindingSummary;
  undispositioned: boolean;
}

/**
 * The latest QC-UNAVAILABLE finding for one version, trigger and lane, with whether it is still open. The scope
 * key of W0-07 3.6 is `run:${trigger}:${lane}`, which the finding's run row carries; dedup (3.4 step 6) appends a
 * new finding only when this one is dispositioned or absent.
 */
export async function findLatestUnavailableFinding(
  exec: Executor,
  versionId: string,
  trigger: QcTrigger,
  lane: Lane | null,
): Promise<LatestUnavailableFinding | undefined> {
  const [row] = await exec
    .select({ finding: qcFinding, open: undispositioned })
    .from(qcFinding)
    .innerJoin(qcRun, eq(qcFinding.runId, qcRun.id))
    .leftJoinLateral(latestDisposition, sql`true`)
    .where(
      and(
        eq(qcFinding.versionId, versionId),
        eq(qcFinding.kind, 'unavailable'),
        eq(qcRun.trigger, trigger),
        lane === null ? isNull(qcRun.lane) : eq(qcRun.lane, lane),
      ),
    )
    .orderBy(desc(qcFinding.createdAt), desc(qcFinding.id))
    .limit(1);
  return row === undefined ? undefined : { summary: storedFindingSummary(row.finding), undispositioned: row.open };
}
```

  Import `latestDisposition`, `undispositioned` from `../findings/repository.js` and `isNull`, `desc` from drizzle. (`findings/repository.ts` already imports from `qc/repository.ts`? Check for a cycle: if `findings/repository.ts` imports `storedFindingSummary` from `qc/repository.ts`, move `latestDisposition`/`undispositioned` into a new `server/src/findings/latest-disposition.ts` that both import. H18 made these the single definition; keep them single.)

- [ ] **Step 2: Orchestrator.** In `orchestrator.ts`:
  - `checkedResult`: `checkOwningLane(finding, mapping, request.lane)`; the unknown-mapping branch returns `'owning_lane_mismatch'` (there is no pending rule any more). Update the comment.
  - Replace the `unavailable` branch of `persistResult` with:

```ts
  if (result.status === 'unavailable') {
    const prior = await findLatestUnavailableFinding(tx, version.id, request.trigger, request.lane);
    const reuse = prior !== undefined && prior.undispositioned;
    await recordRun(tx, version, request, run, result.reason, reuse ? 0 : 1);
    if (reuse) return { status: 'unavailable', reason: result.reason, runId: run.id, findings: [prior.summary] };
    const summary = await appendUnavailableFinding(tx, version, request, run, result.reason);
    return { status: 'unavailable', reason: result.reason, runId: run.id, findings: [summary] };
  }
```

  and add, next to `persistResult`:

```ts
/** W0-07 3.6: the one finding the orchestrator builds itself. Its lane follows the run (W0-06 7.3 part 4). */
async function appendUnavailableFinding(
  tx: Tx,
  version: PackVersionRow,
  request: QcRunRequest,
  run: RunRecord,
  reason: QcUnavailableReason,
): Promise<StoredFindingSummary> {
  const mapping = LANE_MAPPINGS_BY_VERSION[request.laneMappingVersion];
  if (mapping === undefined) throw new Error(`unknown lane mapping ${request.laneMappingVersion}`);
  const owningLane = unavailableOwningLane(
    request.trigger === 'approve_attempt'
      ? { trigger: 'approve_attempt', lane: request.lane as Lane }
      : { trigger: 'submit', lane: null },
    mapping,
  );
  const findingId = uuidv7(run.stamp.getTime());
  const messageParams = { reason, trigger: request.trigger, rulesEvaluated: 0 };
  await insertQcFinding(tx, {
    id: findingId,
    runId: run.id,
    versionId: version.id,
    slot: null,
    kind: 'unavailable',
    ruleId: 'QC-UNAVAILABLE',
    ruleRevision: request.qcRulesRevision,
    severity: 'high',
    owningLane,
    evidence: [{ artifact_id: null, content_hash: null, slot: null, locator: { kind: 'absent' } }],
    metric: null,
    denominator: null,
    threshold: null,
    messageKey: 'qc.finding.unavailable',
    messageParams,
    createdAt: run.stamp,
  });
  return { findingId, ruleId: 'QC-UNAVAILABLE', slot: null, severity: 'high', owningLane, messageKey: 'qc.finding.unavailable', messageParams };
}
```

  The orchestrator only ever runs `submit` and `approve_attempt` (`RunQcInput`), so the `upload` branch of `unavailableOwningLane` is unreachable here; do not add an upload path.
  - `replayPrior`: for the submit-unavailable and unbound replays return the latest unavailable finding instead of `[]`:

```ts
    const latest = await findLatestUnavailableFinding(tx, version.id, input.trigger, input.lane);
    const findings = latest === undefined ? [] : [latest.summary];
```

  - `SubmitQcOutcome`'s `'unknown'` branch keeps `findings: StoredFindingSummary[]` too.
  - Update the header comment (lines 1-5): unavailable results now store the run **and** the QC-UNAVAILABLE finding of W0-07 3.6, once per open scope.
  - `qc-finding.ts:1`: replace the comment with `// W0-04 qc_finding: append-only. owning_lane is NOT NULL and follows W0-06 section 7 as recorded on 2026-09-25 (#35).`
- [ ] **Step 3: Existing expectations.** In `tests/integration/w2-05-dispositions.test.ts` the runs at lines ~190, ~238, ~374 and ~745 assert `findings: []` or zero-finding shapes for unavailable outcomes. Change each to expect one finding with `ruleId: 'QC-UNAVAILABLE'`, `slot: null`, `kind` `unavailable` in the DB, and the owning lane the rule gives (`ai_coe` for submit, the lane for approve attempt); the second not_configured call at ~753 returns the **same** `findingId`. Update the file header (lines 4-5) and the assertion at line ~472 (allow slot 5 and null; keep "never `refinement_pending`" out, the value no longer exists). Each changed assertion gets a one-line comment `// W0-06 7.3 recorded 2026-09-25: an unavailable run stores its finding`.
- [ ] **Step 4: Run** `npm run test:integration -- --test-name-pattern="W2-05"` → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** `server: an unavailable run stores the QC-UNAVAILABLE finding with the run's lane, once per open scope`.

---

### Task 5: Integration tests for the four categories and dedup

**Files:**
- Create: `rai-web/tests/integration/w2-05-owning-lane.test.ts`

Scaffold exactly as `w2-05-dispositions.test.ts:28-160` does (`openFixtureApp` with a `ScriptedQcRunner` bound per test, `submitOk`, `runLaneQc`, `dispose`; copy those helpers, they are file-local). Use `MISSING_SLOT = findFixtureCase('fx-case-missing-slot')!`. The owner is `fx-user-owner-cm`; lanes `fx-user-dpo`, `fx-user-ai-coe`, `fx-user-it-security`. Disposition bodies follow the existing tests (`{ kind: 'waived', reason: '...' , expectedVersion }`).

- [ ] **Step 1: Write the tests** (all in one `describe('W2-05 owning lane (W0-06 7.3 recorded 2026-09-25)')`):

```ts
it('pack-level finding is AI/COE\'s: submit stores PACK-STAGE-MISMATCH with slot null; DPO waiver 403, AI/COE waiver 201', ...)
// submitOk(owner, MISSING_SLOT.caseId); read qc_finding rows for the version: one row rule_id PACK-STAGE-MISMATCH,
// slot IS NULL, kind defect, owning_lane ai_coe. dispose as DPO → 403 error type forbidden; dispose as AI/COE → 201.

it('slot-5 finding belongs to the lane whose rule raised it: DPO lane QC stores it owned by dpo; IT/Security waiver 403, DPO waiver 201', ...)
// runLaneQc(dpoSession, caseId, versionId, 'dpo', revision) → body.findings has ACC-METRIC-CITED slot 5 owningLane dpo.

it('a slot-9 defect from the runner fails the run closed: unavailable runner_error, detail owning_lane_slot_informational, and the QC-UNAVAILABLE finding is stored', ...)
// runner.script({ fixtureCaseId, trigger: 'submit' }, [slot9 finding owningLane ai_coe]) then submit; qc_run status unavailable,
// unavailable_reason runner_error; one qc_finding kind unavailable owning_lane ai_coe; the log line qc.run.unavailable has reason runner_error.

it('a finding outside the approving lane fails the approve-attempt run closed (finding_outside_lane)', ...)
// script the dpo approve_attempt entry with the slot-5 finding owningLane it_security → run unavailable runner_error; finding stored owned by dpo.

it('dedup: two outages on one lane before anyone acts store two runs and one open finding; the run bodies name the same findingId', ...)
// runner.simulateError('runner_error', 'next') twice around two runLaneQc calls for lane it_security.

it('after the owning lane waives the outage finding, the next outage appends a new open finding', ...)

it('not_configured (no runner bound): submit stores one QC-UNAVAILABLE finding owned by ai_coe; the replay returns the same findingId', ...)
// await rebuildApp({ qcRunner: null }) as w2-05-dispositions.test.ts:739 does.
```

  Each test asserts the DB row (`SELECT kind, slot, owning_lane, rule_id, severity, message_key FROM qc_finding WHERE version_id = …`) and the HTTP body, never only one of them.

- [ ] **Step 2: Run** `npm run test:integration -- --test-name-pattern="owning lane"` → all PASS (Task 4 already implemented the behaviour; a failure here is a defect to fix in Task 4, not a test to relax).
- [ ] **Step 3: Commit** `tests: W2-05 owning-lane cases: slot 5, slot 9, pack, unavailable, dedup`.

---

### Task 6: Ready is gated by the outage finding; nothing is carried to N+1

**Files:**
- Modify: `rai-web/tests/integration/w2-05-owning-lane.test.ts` (two more tests)
- Read first: `rai-web/tests/integration/w2-06-ready.test.ts` for the approve helper and how it drives three approvals; `w2-04-resubmit.test.ts` for the send-back → successor → resubmit helper.

- [ ] **Step 1: Write**

```ts
it('A08: an open QC-UNAVAILABLE finding blocks Ready after three approvals; the owning lane\'s waiver releases it', ...)
// use fx-case-vendor (no scripted pack/slot-5 findings); induce runner_error on the dpo approve attempt; approve all three
// lanes (dpo approves after seeing the unavailable run, W0-06 4.4); SELECT ready_at IS NULL; the last approve response's
// ready evaluation lists the finding id under undispositionedFindingIds; DPO waives with reason; Ready is set by that
// disposition transaction (case.ready_for_launch audit row with triggered_by_event disposition.recorded).

it('7.3 part 5: the QC-UNAVAILABLE finding on N is not carried to N+1 and stays readable on N', ...)
// outage on N (submit), send-back, resubmit N+1 with the runner healthy: N+1 has no qc_finding of kind unavailable;
// GET …/versions/N/findings still lists it.
```

- [ ] **Step 2: Run** → PASS. If Ready is reached with the finding open, the defect is in `undispositioned` / `evaluateReadyPredicate` (it must count every `kind`); fix there, never in the test.
- [ ] **Step 3: Commit** `tests: Ready waits for the outage finding; not carried to N+1`.

---

### Task 7: Reviewer workspace shows the outage finding with its controls

**Files:**
- Read first: `rai-web/web/src/screens/case/finding-list.tsx:40-100`, `reviewer-workspace.tsx:130-170`, `view-model.ts` (how `run.findings` reaches the list).
- Modify: `rai-web/web/src/screens/case/finding-list.tsx` (and `view-model.ts` if the unavailable branch drops `run.findings`)
- Test: `rai-web/web/src/screens/case/view-model.test.ts`; `rai-web/tests/browser/w2-int-07-reviewer-workspace.spec.ts` (one new test)

- [ ] **Step 1: Unit test (view model).** Add a case: a lane-QC run body `{ status: 'unavailable', reason: 'timeout', runId, findings: [<QC-UNAVAILABLE summary owned by the viewing lane>] }` yields a view model with the unavailable notice **and** one finding row whose `owningLane` equals the viewer's lane, so the disposition controls are offered. Run → FAIL if the branch discards findings.
- [ ] **Step 2: Implement.** In `finding-list.tsx` keep the existing `review-qc-unavailable` status block (lines 85-96) and render the findings list beneath it when `run.findings.length > 0`. The row rendering already handles `slot === null` (`review.findings.slot_none`, "Pack level"); for `ruleId === 'QC-UNAVAILABLE'` show the run id line under the message (`review.qc.run_id`), nothing else new. No new locale keys unless a label is needed; if one is, add it to both catalogues.
- [ ] **Step 3: Browser test.** In `w2-int-07-reviewer-workspace.spec.ts` add: sign in as DPO on a submitted fixture case with the test-control outage (see how `w3-int-fault-controls.spec.ts:10-80` induces a real timeout), open the DPO workspace, expect `[data-review-qc="unavailable"]` visible **and** one `[data-review-qc="findings"] [data-finding-id]` row with the waive control enabled; waive it with a reason; the row shows the waived state. Run at the three widths the config uses.
- [ ] **Step 4: Run** `npm run test:unit -w web`, then `npm run build && npm run test:browser:server -- --grep "W2-INT-07"` → PASS.
- [ ] **Step 5: Commit** `web: the reviewer sees the QC-UNAVAILABLE finding under the outage notice and can disposition it`.

---

### Task 8: Register row, contract text, records

**Files:**
- Modify: `docs/product/decisions.md` (one new row in "Recorded decisions"; D05 row's affected documents gains "7.3 record 2026-09-25")
- Modify: `docs/engineering/workflow-transition-and-error-contract.md` sections 7.1, 7.2, 7.3, 7.4, and the summary rows at lines ~599 and ~611, and the 4.6 "not defined by the source" sentence
- Modify: `docs/engineering/qc-boundary-and-mail-sink.md` line 14 (open item), 3.4 step 5 (line 191) and the unavailable sentence in step 6 (line 192), 3.5 table (reserved rows → scripted, `QC-UNAVAILABLE` row unchanged), 3.6 (open → recorded; the `owningLane` comment in the code block), 3.9 row (line 308)
- Modify: `changes/2026-09-23-w3-hardening/issue-35-decision-brief.md` (a two-line "Decided 2026-09-25" note at the top), `walkthrough-script.md` (the "What Nakhun will notice" item about slot 1 / Ready now says the outage finding must be waived by its lane)
- Modify: `DEVLOG.md`, `CHANGELOG.md` (entries dated 2026-09-25), `docs/board/lane-b-ui-notifications.md` (append the ticket entry)
- Create: `changes/2026-09-25-w2-05-owning-lane/review.md`

- [ ] **Step 1: The register row.** Insert after the `W0-04 fields` row, with Ta's approved wording (draft below; Ta confirms in chat before the PR opens):

```
| D05 refinement (#35) | Owning lane for slot-5, slot-9, pack-level and QC-unavailable findings; carry-over | Slot 5 (BRD): the lane whose QC rule raised the finding; on an approve-attempt run, that run's lane. Slot 9: informational only, QC raises no defect there. Pack-level: AI/COE. QC unavailable: the lane whose run it is on an approve attempt; AI/COE on submit; the slot's lane on upload of a single-lane slot (upload on slot 5 or 9 is defined with upload QC in W4). A finding on version N is never carried to N+1; each version is dispositioned on its own | Ta, acting for the review leads within D05 | 2026-09-25 (Claude Code session, after reading the #35 decision brief) | W0-06 7.1-7.4, W0-07 3.5/3.6/3.9, W2-05, W1-10 fixtures, issue #35, epic #53 |
```

- [ ] **Step 2: W0-06.** 7.1: replace the code block with the `owningLaneRule` signature and the sentence that slots 5 and 9 now follow 7.3. 7.2: retitle "QC-unavailable findings: recorded rule" and state part 4. 7.3: retitle "Recorded D05 refinement (2026-09-25)"; keep the option table for the record and fill **Recorded refinement:** with the five rules, approver, date, channel. 7.4: retitle "What W2-05 and W1-10 did once the rule was recorded" and rewrite in the past tense (the substitute scripts a slot-5 and a pack finding; the orchestrator stores the QC-unavailable finding). Fix the two summary rows and the 4.6 sentence.
- [ ] **Step 3: W0-07.** Line 14: the open item becomes "recorded 2026-09-25, W0-06 7.3". 3.4 step 5: replace the `refinement_pending` sentence with the rule (slot 5 any reviewing lane and on approve attempt the run's lane; slot 9 refused as `owning_lane_slot_informational`; pack AI/COE). Step 6: "the QC-unavailable finding is appended once per open scope; a still-open one is reused and the run body names it". 3.5: `PACK-STAGE-MISMATCH` → "yes (fx-case-missing-slot, submit)", `ACC-METRIC-CITED` slot-5 variant → "yes (fx-case-missing-slot, approve_attempt dpo)", `PACK-CONTRADICTION` stays reserved (no fixture yet; not owed by W2-05). 3.6: replace the "Open" and "Interim posture" bullets with one "Recorded (W0-06 7.3, 2026-09-25)" bullet and fill the `owningLane` comment in the code block with `unavailableOwningLane(run, mapping)`. 3.9 row: the assertion is now "every scripted finding satisfies `owningLaneRule`; slot 9, run scope and QC-UNAVAILABLE throw at construction".
- [ ] **Step 4: Grep guard.** From the repository root `grep -rn "rule_pending\|refinement_pending" docs rai-web --include='*.md' --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v /dist/` must print nothing except historical `changes/` records.
- [ ] **Step 5: Records.** DEVLOG entry "W2-05 owning-lane rule (#35) — 2026-09-25" (what the rule is, what changed in behaviour, counts from Task 9). CHANGELOG line. Board entry on lane B with the PR as evidence. Brief and walkthrough notes. `review.md` skeleton with sections: decision, files, commands and results, reviewer verdicts, exceptions.
- [ ] **Step 6:** `node scripts/check-links.mjs`, `node scripts/check-frozen-source.mjs`, `git diff --check` from the root → clean. Do **not** run prettier over existing docs; format only files this change created.
- [ ] **Step 7: Commit** `docs: record the #35 owning-lane rule (W0-06 7.3) and update W0-07; W2-05 records`.

---

### Task 9: Full suite, PR, review, merge

- [ ] **Step 1:** `npm run lint && npm run typecheck && npm run test:unit && npm run test:integration && npm run build && npm run check:substitute-absent && npm run test:browser` in the worktree, plus `node --test tests/*.test.mjs` and the two check scripts from the root. Record every command and its last lines in `review.md`. A browser spec that fails because an induced outage now leaves a finding (candidates: `w3-int-fault-controls.spec.ts`, `w3-int-07-desk-health.spec.ts`) is updated to expect the finding, with a comment citing W0-07 3.6; it is not skipped.
- [ ] **Step 2:** Push; `gh pr create --base main` with the ticket id, the A-IDs proved (A08, A09), the register row, commands and output, and the product consequence from the spec. End the description with the attribution line.
- [ ] **Step 3:** Two independent reviewer agents (correctness and tests; contract, security and simplicity) post verdicts on the PR. Fix, re-run, re-review until both PASS on one head. Wait for CI on that head.
- [ ] **Step 4:** Merge through the D03 ticket flow (`gh pr merge --squash --delete-branch --match-head-commit <head>`). Close #35 and epic #53 with a comment linking the register row and the PR. Set the W2-05 issue label to `status:evidence-recorded`. Append the merge to the board entry's Evidence. Stop the worktree's Postgres (`docker compose -p rai-w2-05 down -v`) and remove the worktree.
