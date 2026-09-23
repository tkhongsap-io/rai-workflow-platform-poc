# Intent: close W3 for package review — retro-review, simplify, harden

Ta's instruction on 2026-09-23, after reading the team's W3 summary and the independent assessment: do not accept W3 yet; first (1) independently review the code that merged without review, (2) fix what that review confirms, (3) close two resilience gaps, (4) review the architecture and simplify the code so it is maintainable rather than agent "slop", and (5) leave the repo clean for Ta's package review and a synthetic walkthrough with Nakhun.

Why: W2-01..05 (#90-#95) merged with zero reviews and partly while CI was not executing; most W3 implementation PRs show no review on GitHub. These cover lane decisions and dispositions, the authorization-sensitive core. The Postgres pool has no error handler, and the CSRF check covers sign-out only.

Scope: W0-W3 code on main under the existing D03 authorization. No new product scope, no W4 work, no change to recorded decisions, synthetic data only. Issue #35 (finding ownership for slot 5/9, pack-level and QC-unavailable findings) is a product rule for Ta and the review leads; this change prepares options, it does not decide.
