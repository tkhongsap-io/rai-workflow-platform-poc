# Plan

1. Board claim on the Lane A stream.
2. Delete the function and its now-unused import; correct the module comment.
3. Update W0-04 Interfaces, W0-05 query-scope paragraph and performance-targets.
4. Grep guard: no `scopedCases` outside dated records.
5. Full suite serially on Postgres 55372; PR; two reviewers; CI; merge.
