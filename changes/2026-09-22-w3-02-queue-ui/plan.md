# Plan recorded before code

1. First separate contract commit: additive locale keys in th/en, SPA queue path, API queue path and typed client method plus focused client/route tests. Record contract check results and report commit to parent for separate prerequisite PR.
2. Second commit: queue screen/view model/styles, route registration and primary shell navigation. Preserve /cases and existing landing/post-create behavior. No further locale/shared client changes in implementation commit.
3. Unit-check URL parsing/serialization and locale/action mapping. Browser-check substitute cards and transitions, URL history, error/loading/retry, keyboard/axe across all three widths and independent owner/BU/reviewer/empty scope negatives including direct API and deep links.
4. Own npm ci with Node24. Use SUBSTITUTE_PORT=58789 and SUBSTITUTE_WEB_PORT=55175; no shared DB. Run full unit and substitute UI suites, lint/typecheck/build and repository checks. Inspect diff, record exact evidence and limits, commit locally. Parent handles prerequisite/consumer PRs and W3-INT.
