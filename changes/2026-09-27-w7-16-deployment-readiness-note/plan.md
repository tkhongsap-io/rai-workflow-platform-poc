# Plan

1. Board CLAIM (lane C stream). Change frame (this folder).
2. Facts: read `config.ts`, `identity/config.ts`, `secrets/index.ts`, `start.ts`, `main.ts`, `observability/{routes,health}.ts`, the operator commands and `docker/postgres/init/001-roles.sql`; probe the built server's start without a fixtures build (loopback, fixture mode, no external call).
3. RED: `rai-web/server/src/deployment-readiness.test.ts` (spec item 4); run it and watch it fail (note missing).
4. GREEN: write `docs/engineering/deployment-readiness.md`; rerun until every test passes. Mutation checks: drop a table row, add a stale row, change a production value to one the parse refuses.
5. Link the note from the W7 plan's section 12 (dated note) and the engineering index where one exists.
6. Full W7 plan section 10 gate one suite at a time, logs under `/tmp/rai-w7-16-deployment-readiness-note-logs/`.
7. review.md, DEVLOG, CHANGELOG; commit, push, verify the remote head, open the PR ("Refs #234").
