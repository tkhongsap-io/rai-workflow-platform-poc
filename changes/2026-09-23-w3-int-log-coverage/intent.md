# Intent

Close the in-process integration-log gap in W0-10 OBS-15 using test-only instrumentation. Parent requested a file-level plan before code and will approve the bounded scope. Base: published API b060df1; isolated worktree /tmp/rai-w3-int-log-coverage, branch codex/w3-int-log-coverage. Published API files/worktree remain untouched.

Done when every integration buildApp path uses audited serialized logging, existing custom-stream assertions still pass, deliberate leaks demonstrably fail the test process (including late writes and split UTF-8), and a mechanical guard prevents bypasses. Passing three process-canary scenarios alone is not suite-wide proof. No production/runtime configuration changes, product flags, global stdout interception, PR or push.
