# Rehearsal plan: <run ID>

Template (W7-10). Copy into the run's record folder before the run; see the [kit README](README.md). Source: [W7 plan](../../engineering/implementation-plan-w7.md) sections 1.2 (W7-D1, W7-D13 to W7-D16, W7-D18, W7-D19) and 11.

> **Data:** synthetic data only for agent runs. A real rehearsal (W7-D19) is **pending D08 and the operator**; its contents never enter Git.

## 1. Run identity

| Field | Value |
|---|---|
| Run ID (timer `runId`, `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`) | |
| Kind | synthetic scripted (W7-12) / synthetic by hand (W7-14) / real (W7-D19, pending D08) |
| Date and time (UTC) | |
| Commit (`BUILD_COMMIT`) | |
| Fixture set identity (`fixtures:load` line) | |
| Identity mode | `fixture` on loopback (W7-D1) / other: |
| QC mode | `QC_MODE=content` with `QC_MODEL=disabled` / `deterministic` fallback: reason |
| Mail mode | `MAIL_MODE=sink-file` / other: |
| Server | built (`npm run build`, `npm start`) / other: |
| Operator guide revision | `docs/operations/operator-guide.md` at commit: |
| Timing output | `REHEARSAL_OUT_DIR/<run ID>/timings.{json,csv}` |

## 2. Scope

Cases (the plan's [section 11](../../engineering/implementation-plan-w7.md#11-rehearsal-case-set-w7-11) for synthetic runs):

| Case | Scenario | Expected end state | In scope (yes/no, reason) |
|---|---|---|---|
| REH-1 | | | |
| REH-2 | | | |
| REH-3 | | | |
| REH-4 | | | |
| REH-5 | | | |

Out of scope for this run, with the reason:

-

## 3. Roles

| Role | Person or synthetic principal | Acts in steps |
|---|---|---|
| Operator | | |
| Owner / BU SPOC | | |
| AI/COE reviewer | | |
| DPO reviewer | | |
| IT/Security reviewer | | |
| Admin | | |
| Observer and timekeeper | | |

## 4. Preconditions

- [ ] Clean database loaded with the case set (`npm run rehearsal:load` output: `loaded.json` path)
- [ ] `/readyz` 200 and desk health shows no unavailable dependency
- [ ] Backup taken before the run (`npm run backup -- --label <run ID>`), backup ID:
- [ ] Timer output directory resolves under `rai-web/.local/`
- [ ] For a real run only: D08 permission recorded, recipients controlled, no external mail unless explicitly authorized

## 5. Steps

Follow the operator guide in its order. The step ID is what the timer records (`start(stepId, { section })`) and what the timing sheet and deficiency log cite.

| Step ID | Guide section | Case | Actor | Action | Expected result |
|---|---|---|---|---|---|
| G1.sign-in | | | | | |
| | | | | | |

## 6. Stop rules

- Stop and log a **blocking** deficiency (W7-D16, see the [deficiency log](deficiency-log-template.md)) when a version, its bytes or its audit trail is lost or altered, authorization is wrong, readiness or Ready gating is wrong, a guide step is impossible, a start-up fails open, or data outside the synthetic set appears.
- A step that fails without a blocking cause is logged, its outcome recorded as `failed` or `skipped`, and the run continues.
- Timings are recorded without a target (W7-D15); a slow step is a note, not a failure.

## 7. Sign-off before the run

| Who | Role | Date |
|---|---|---|
| | | |
