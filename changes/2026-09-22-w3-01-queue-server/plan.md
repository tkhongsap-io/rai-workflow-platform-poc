# Plan recorded before implementation

1. Create dedicated /tmp/rai-w3-queue-server worktree on codex/w3-01-scoped-queue at ae8e25d; claim the delegated server slice of Lane A.
2. Implement queue SQL repository and route. Register alongside existing case routes with the same database dependency, preserving GET /api/cases. Keep all response reads inside a repeatable-read read-only transaction.
3. Add unit coverage for literal search and status-to-action mapping; real-Postgres integration coverage for all scopes/search keys, combined filters, counts/options isolation, pagination, normalization/Thai names, errors, five statuses, successor drafts and frozen SLA. Prove snapshot behavior under an intervening committed write.
4. Use dedicated Compose project rai-w3-queue-server on loopback port 54362, never parent 54351; independent dependencies and local environment, Node 24.
5. Run focused tests, typecheck, lint, full unit/integration regression, build and repository checks. Record exact outcomes/limitations in review.md and inspect scoped diff. Commit only these owned files. Parent independently reviews and runs delivery gates after PR #106 merges. No push/open PR/merge.
