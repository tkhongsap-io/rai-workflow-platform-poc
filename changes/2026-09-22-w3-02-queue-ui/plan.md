# Plan recorded before code

1. First separate contract commit: additive locale keys in th/en, SPA queue path, API queue path and typed client method plus focused client/route tests. Record contract check results and report commit to parent for separate prerequisite PR.
2. Second commit: queue screen/view model/styles, route registration and primary shell navigation. Preserve /cases and existing landing/post-create behavior. No further locale/shared client changes in implementation commit.
3. Unit-check URL parsing/serialization and locale/action mapping. Browser-check substitute cards and transitions, URL history, error/loading/retry, keyboard/axe across all three widths and independent owner/BU/reviewer/empty scope negatives including direct API and deep links.
4. Own npm ci with Node24. Use SUBSTITUTE_PORT=58789 and SUBSTITUTE_WEB_PORT=55175; no shared DB. Run full unit and substitute UI suites, lint/typecheck/build and repository checks. Inspect diff, record exact evidence and limits, commit locally. Parent handles prerequisite/consumer PRs and W3-INT.

## Independent review follow-up, before consumer PR

Fix P2 Reset by explicitly clearing every local filter draft (search, searchBy, status, owner, group and page size) before clearing the URL, including when the URL is already bare /queue. Add a browser regression that changes every draft without applying, resets, then applies and proves no restrictive filters remain at all three widths. Run focused queue and full substitute browser suites, unit, lint and typecheck; record results in this change's review.

Bounded engineering exception: keep this one cohesive queue flow together, approximately 535 implementation lines plus 371 browser-test and 47 unit-test lines at the reviewed baseline. It is reviewable in one sitting, and splitting its tests would separate behavior from its proof. The independent reviewer recommended this exception; the user authorized lead implementation judgment before the consumer PR. The shared contract remains a separate prerequisite commit. This exception grants no A06 real acceptance: substitute checks remain UI rehearsal, with real-server evidence and acceptance deferred to W3-INT.

### Re-review: every Reset entry point

Replace the form-only reset with a parent-owned reset counter included in the form key. Every Reset button clears the URL and increments this counter, so a bare URL still remounts all draft controls from defaults. Extend the regression to the empty-owner empty-state Reset at all widths, then run focused/full substitute browser, unit, lint and typecheck checks before a local fix commit. The accepted size exception and A06 boundary remain unchanged.
