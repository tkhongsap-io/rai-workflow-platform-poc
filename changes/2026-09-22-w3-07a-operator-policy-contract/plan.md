# File-level plan

1. Add only rows('operator.view', ADMIN_ONLY) in rai-web/server/src/authz/policy.ts.
2. Update the exact policy inventory and add a focused Admin/non-Admin/combined-role test in rai-web/server/src/authz/policy.test.ts.
3. Run the policy suite, focused lint/format, and repository link/frozen-source/diff checks. Commit only these two files and this change record. Parent cherry-picks and reviews a separate prerequisite PR; API consumer files remain outside the commit.

The row was initially prepared during consumer HTTP testing. Before further policy edits or publication, the owner required this extraction; no independent policy prerequisite is claimed merged by this record.
