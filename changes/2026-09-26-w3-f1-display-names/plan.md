# Plan

1. RED: the new integration test (3 cases) fails on the missing fields.
2. Contract: optional fields in `@rai/shared` schemas and the version 201 response schema (right after `submittedBy`, so the serialised key order is fixed).
3. Server: one subject directory in `composeAppDeps` for cases and versions; `readNames` memoises per read; case reads use the column; version list, by-id and latest reads and the submit 201 resolve through the directory.
4. GREEN, then the full integration suite; update the two exact-shape expectations with a citation.
5. Docs: W0-02 section 7, W0-05 resolution note; board claim; DEVLOG/CHANGELOG; review record.
6. Full suite serially on the worktree's own Postgres (55372); PR; two reviewers; CI; merge through the D03 ticket flow. Part 2 (UI) follows as its own PR.
