# Review: W3-F1 display names, part 1 (contract and server)

Framed in [intent](intent.md), [spec](spec.md) and [plan](plan.md). Decision implemented: register row "W3 deferred rulings", item 8 (Ta, 2026-09-26). Synthetic data only.

## Change

- `@rai/shared`: optional `ownerDisplayName` on `CaseView`/`CaseSummary`, `submittedByDisplayName` on `VersionSummary`/`SubmittedVersion`, `decidedByDisplayName` on `LaneDecision`. Subject IDs unchanged.
- Server: one subject directory in `composeAppDeps`, shared by the case and version routes; `readNames` resolves each subject at most once per read. The owner's name is the `business_owner` column; the submit 201 and every version read resolve the submitter through the same directory; decision reads name the decider. The 201 response schema lists the field right after `submittedBy`, so key order is fixed for replay.
- Docs: W0-02 section 7 shapes and a display-only note; W0-05's W0-09 resolution row gets a dated extension note.

## Design note found by the tests

The first version took the 201's name from the acting principal while reads used the directory. A W1 suite that wires a directory for the case routes but not for the version routes showed the 201 and a later read differing. The 201 now resolves through the same directory (the actor is only the directory's fallback, and no directory means no name), so both agree in every wiring of the fixture directory. With a sign-in directory, a later read can differ if a display name changes or session rows are swept (review round 1); names are display only, and pinning them there is a W7 follow-up.

## Commands and results

Worktree `/tmp/rai-names`, Postgres `rai-names` on 55372, one suite at a time.

| Command (from `rai-web/` unless noted) | Result |
|---|---|
| RED: `node --test tests/integration/w3-f1-display-names.test.ts` before the change | 3 tests, 0 pass (fields absent) |
| `npm run lint`, `npm run typecheck` | exit 0 |
| `npm run test:unit` | 582/582 (round 1); 586/586 after round 1's four helper tests |
| `npm run test:integration` | 332/332, 0 skipped (after updating the two exact-shape expectations in `w1-05-submit` and `w2-02-lane-decision`, each with a citation) |
| `npm run build && npm run check:substitute-absent` | 595 files, 0 markers; 603 files, 0 markers after round 1 |
| `npm run test:browser:server` | 193 passed (7.5m), again after round 1; the UI still shows IDs until part 2 |
| `npm run test:browser:substitute` | 48 passed |
| root `node --test tests/*.test.mjs`, `scripts/*.test.mjs` | 22/22, 18/18 |
| `check-links`, `check-frozen-source`, `git diff --check` | 0 broken; hash matches; clean |

## Reviewer verdicts

| Round | Head | Correctness | Contract and privacy |
|---|---|---|---|
| 1 | `a7f341d` | PASS; non-blocking: byte-identity claim too broad outside fixture mode; name lookups on a second pool connection while a transaction holds one; no unit test for unknown subject / no directory; no `/versions/latest` byte check | PASS; non-blocking: the same byte-identity wording; "superseded in part" vs "extended"; W0-02 field placement; a part-2 note on #163 after merge |

Round-1 changes: names are resolved outside every transaction (submit resolves before it opens; version reads after the snapshot; case update after commit; case create needs none); the byte-identity claim is narrowed to fixture mode with a W7 follow-up; `versions/display-names.ts` holds the two placement helpers with unit tests (unknown subject, no directory, once per read, key order; regression pins, passing on first run by design); the integration test also compares `/versions/latest` bytes; W0-05 says "extended"; W0-02 notes the field placement.

## Part 2: the UI (separate PR)

The five surfaces the ruling names render `displayName ?? subjectId`: the case header's business owner (`case-overview.tsx`), the My cases card (`case-list.view-model.ts` `ownerLabel`, `case-list-screen.tsx`), "submitted by" in the version list (`version-nav.tsx`) and on the frozen version (`pack-frozen.tsx`), and "decided by" on lane decisions including the owner's send-back feedback (`lane-decisions.tsx`). A read without a name still shows the subject id. No request echoes a view field (the new-case form keeps its own form state), so no update is refused for `ownerDisplayName`.

Tests: RED first, the row-model unit test (the card falls back to the id, and shows the name when the read carries one) failed before the change; the browser specs that asserted subject ids on screen now assert the names (`w1-int-journey`, `w1-int-06-case-pack-versions`, `w2-int-journey`), subject ids stay asserted wherever the API or the database is checked, and the journey also checks the My cases card and the case header. Those three specs: 36 passed at three widths on a fresh build.

Full suite for part 2 (same worktree and database, one suite at a time): lint and typecheck clean; 587 unit; 332 integration, 0 skipped; build, 603 files, 0 substitute markers; 193 real-server browser; 48 substitute browser.

### Part 2 reviewer verdicts

| Round | Head | Correctness | Contract and privacy |
|---|---|---|---|
| 1 | `9f3e5a9` | PASS; the SPOC-signed-in assertion at `w1-int-journey` got weaker (the SPOC's name also matches the shell's "signed in as"); stale comment in `lane-decisions.tsx`; hardcoded name in `w2-int-journey` | BLOCKING on records: the done-when asks for both locales and a test pinning each surface, but every check was Thai and `getByText(name).last()` did not pin the version list and the frozen version separately |

Round-1 changes: each name check is scoped to its surface, with a `fact()` locator over `dl.facts` for the case header and the frozen version's "submitted by" and `.version-meta` for the version list, so none can match the shell's own name; English checks on the case header (`overview-draft-en`) and the My cases card (`list-en`); the w2 name comes from the fixture users; the `lane-decisions.tsx` header comment is corrected. The four affected specs (`w1-int-journey`, `w1-int-06-case-pack-versions`, `w1-int-07-shell-sign-in-cases`, `w2-int-journey`): 96 passed at three widths; lint and typecheck clean. Only test code and one comment changed after the full suite above.
