# Operator sidecar verification

## Scope and dependency identity

Own implementation is only `rai-web/tests/browser/w3-int-07-desk-health.spec.ts` (238 lines) plus this packet. No application, shared helper, board, package or CI edits. Parent owns integration/publication; another agent must independently review this authored portion.

Executed dependency head: `5d043bc2e11f02a800d4ffb56ae1efd2d23b9429`, a clean local assembly of actual merged UI main `a0d4287e78117ef7d7e3d3c7587c7634cbc25b72` and corrected INT helper `1e6ccc344071c7ac294b4b84c68870e939be589b` with its committed OBS15 prerequisites. Initial helper967 was not used for final proof. Local dependency merges are not publication or a merge to main.

## Actual proof

Real Playwright focused run: **3 passed, 0 failed, 0 skipped**, 2.4 minutes; desktop1440 45.8s, tablet834 45.6s, phone390 45.6s. All three use isolated generated databases and real worker timing, with no API interception, fake operator SQL, clock advance or weakened assertions.

For each width:

- Fixture `fx-case-nonvendor` is submitted through real HTTP; the configured worker records one submit timeout. Ordinary four lane notices are delivered before the sink fault is enabled.
- DPO sends back through real HTTP. The dispatcher exhausts four actual attempts against a filesystem-failing FileMailSink. Read-only SQL confirms exactly one failed send-back notification with attempts4, plus one unavailable submit QC row.
- Exactly three `mail.attempt_failed` logs carry attempts1/2/3; exactly one terminal `mail.failed` carries attempts4. Exactly one `qc.run.unavailable` and one captured error per target match their actual HTTP/persisted/report correlations.
- Real Admin API and Thai/English UI display each target ID once with its matching readonly correlation. Refresh, correlation selection and locale selection use keyboard with visible focus; refresh retains focus and both records. No horizontal overflow at any width.
- All seven non-Admin fixture identities receive HTTP403; anonymous receives401. Owner UI shows localized forbidden without target IDs/recipient or operator navigation.
- Nine axe audits (Admin Thai, Admin English, owner forbidden across three widths) passed the zero critical/serious gate. Structured target-correlation evidence and axe results are attached to the local Playwright report.

HTTP workflow/auth setup is setup proof, not a claim of keyboard-only workflow entry. No manufactured QC owning lane or finding; issue35 remains outside this proof. No full W3-INT acceptance, performance or production claim.

## Commands and resources

Node24.21.0; owned dependencies installed using `npm ci --ignore-scripts`. Runtime command from rai-web:

```sh
PATH=/Users/tkhongsap/.nvm/versions/node/v24.21.0/bin:$PATH \
NODE_ENV=test RAI_IDENTITY_MODE=fixture \
DATABASE_URL=postgres://rai_app:rai_app@127.0.0.1:54372/rai \
DATABASE_MIGRATE_URL=postgres://rai_owner:rai_owner@127.0.0.1:54372/rai \
DATABASE_OPERATOR_URL=postgres://rai_operator:rai_operator@127.0.0.1:54372/rai \
PLAYWRIGHT_BASE_URL=http://127.0.0.1:58849 \
node --env-file=.env.example node_modules/@playwright/test/cli.js test \
-c tests/browser/playwright.config.ts w3-int-07-desk-health.spec.ts
```

Only synthetic loopback credentials from the repository compose contract. Own Docker project `rai-w3-int-operator`, Postgres54372, base database migrated (eight migrations). Each callback stops the owned child before database cleanup, including failures. Post-run read-only database inventory found no generated browser_mail database remaining; no listener remained on58849. Own base DB remains idle for parent coordination.

Local artifacts: `/tmp/rai-w3-int-operator-browser.log` and `/tmp/rai-w3-int-operator/rai-web/playwright-report/index.html`. First launch without example defaults refused on missing TRUST_PROXY before browser execution; loading the existing example defaults corrected command configuration, with no source change.

Other checks on final dependency base and authored spec: full `npm run typecheck`, focused ESLint and Prettier check passed. Real Playwright discovery found exactly three tests. Repository Markdown check:219 files/733 links/zero broken; frozen-source hash matched; git diff --check passed. Playwright rebuilt the actual SPA/server and fixtures before execution. Build reports its existing >500kB bundle advisory; runtime reported NO_COLOR/FORCE_COLOR warnings, neither suppressed.

## Handoff

Heisenberg requested the owned spec+packet commit for complete assembly and full gates. Only these five paths belong in that commit; do not cherry-pick local dependency merge commits. Independent review and combined full-suite gates remain parent-owned.
