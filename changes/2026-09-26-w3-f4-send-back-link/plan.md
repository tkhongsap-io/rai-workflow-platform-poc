# Plan

1. Board claim (Lane B).
2. RED: compose unit test for the send-back route.
3. GREEN: `caseLink` in compose; the outbox stores `casePath` for send-back rows (the first attempt without it failed the worker's agreement check in w3-03a, which is how the stored path was found).
4. Integration pin; W0-07 text; table note; records.
5. Full suite serially on Postgres 55372; PR; two reviewers; CI; merge.
