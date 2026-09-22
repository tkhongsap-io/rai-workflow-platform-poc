# W3-04 retry intent

Issue #45 / A05, assigned by Ta on 2026-09-22. Prepare the retry policy on `codex/w3-04-retries` from main `5fe59ad` in `/tmp/rai-w3-retries`. One future W3-04 PR references #45; no push or merge.

First slice: pure attempt/backoff/eligibility helpers and tests only. Hypatia retains W3-03a composition. Wait for the parent-provided committed consumer before cherry-pick/rebase and delivery integration. No other worktree writes, new issues, external mail, lease or migration. DB port 54365 is reserved for later isolated integration; do not use 54351/54362/54363/54364.
