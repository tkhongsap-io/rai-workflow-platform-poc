# Verification

## Local design demo

The owner authorized the synthetic demo on 2026-09-21. This is a bounded exception to the earlier Markdown-only inventory rule. Production acceptance remains governed by docs/acceptance.md and the W0–W8 plan.

Start the app in one terminal:

```sh
python3 demo/serve.py
```

Run component and provenance tests from repository root (Node 18 or later):

```sh
node --test tests/*.test.mjs
```

The harness loads the actual Component from demo/index.html. Tests cover state transitions, negative role/version/Ready cases, QC, configuration, exact exported-source preservation and frozen product-source identity. These are prototype/UI invariants, not proof of backend authorization.

### Browser end-to-end suite

[tests/browser-journey.mjs](tests/browser-journey.mjs) exports runReviewJourney(page) and runAdditionalChecks(page). Both accept a Playwright-compatible page with getByRole, locator, and getByRole(...).all(). Tests assert user-visible state and interact only through UI controls. They work with a normal Playwright page or Codex tab.playwright. No fixed sleeps, private application state or direct event-handler calls.

For Codex, read the exported functions into the supported browser REPL, bind the localhost tab, and execute:

```js
await runReviewJourney(tab.playwright);
await runAdditionalChecks(tab.playwright);
await runFunctionalGate(tab.playwright);
await runDispositionChecks(tab.playwright);
```

The last two functions are exported from [tests/browser-functional-gate.mjs](tests/browser-functional-gate.mjs). They cover pack save/discard, negative validation, six-role controls, history/notification links, all disposition kinds and Admin recovery. See the [functional gate](changes/2026-09-21-local-design-demo/functional-gate.md) for executed outcomes and fixes. Small visual differences are accepted by the owner; functional failures are not.

With an existing developer Playwright installation, import the functions, navigate a page to http://127.0.0.1:5173/, and call all four with that page. Playwright is not bundled here and no standalone CLI browser runner is claimed. The app itself needs no npm packages.

The first function verifies submit with findings, send-back, document correction, version 2, three approvals, blocked readiness, dispositions and Ready. The second verifies new-case validation/Unknown/N/A, admin revision, all preview widths, unavailable QC, checklist v2 isolation and reset. See the dated [review](changes/2026-09-21-local-design-demo/review.md) for executed results.

### Visual verification

Compare the same synthetic state in the [Claude reference](https://claude.ai/artifact/25FPuPyj6aczLrXca3P9Mz) and local page. Match browser viewport, preview width and role. Import [compareArtboards](tests/visual/compare-artboards.mjs), then call `await compareArtboards(localPage, referenceFrame, exactHeading, stateLabel)` after UI navigation. Inspect the returned differences; this helper reports rather than throws. It normalizes the outer canvas offset and compares every positive-size element except script/style/option nodes and runtime interpolation spans. It checks tags, geometry (0.001 CSS-pixel numerical tolerance) and 25 computed CSS properties. Text and native control behavior require separate assertions.

The [expanded results](tests/visual/expanded-geometry-results.json) record 58 executed comparisons across the primary workflow and dialogs at 1440/834/390. Equal node counts and styles were observed throughout; maximum coordinate delta was 0.0001220703125 CSS pixels. Earlier sampled text/control results remain in tests/visual/geometry-results.json. Width controls close notifications, so reopen the drawer at each width before capturing that state. These are authored preview widths, not a claim of exhaustive real-device coverage.

Screenshot captures supplied by the current browser tool are lossy JPEG even when previous files were named .png. The current original JPEGs and decoded crops are named queue-fixed-*. A JPEG pixel difference is not a lossless visual assertion. Zero-pixel equality across the whole workflow has not been certified. Do not promote the exact sampled geometry result into that broader claim.

## Repository checks

Run git diff --check, inspect git status and relative Markdown links, verify frozen source SHA-256 against docs/sources.md, and inspect the change review for unresolved scope/acceptance gaps. Product sources remain immutable. Only synthetic fixtures belong in demo/ and tests/; no credentials or real case material.

## Production gates

No production stack, identity, persistence, model service or deployment is implemented by the demo. Before real-data rehearsal, approve handling/access/retention. Before production, enforce transitions and permissions server-side, evaluate QC, test concurrency, notifications, backup/restore and rollback, and obtain operator acceptance. Synthetic UI success is not production acceptance.
