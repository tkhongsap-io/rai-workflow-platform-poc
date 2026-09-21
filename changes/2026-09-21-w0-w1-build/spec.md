# Change specification

Done when, for every ticket in W0 (#6-#15) and W1 (#16-#30):

- a `codex/<ticket-id>-<topic>` branch and PR exist, titled with the ticket ID;
- the PR body states the ticket ID, the A-IDs it proves, the commands run and their output;
- the full test suite is green on the branch, and again on main after merge;
- two independent reviewer agents (correctness and tests; contract, constraints and security) reported no blocking finding on the final revision;
- the documents the ticket touches are updated in the same PR (specs, TESTING.md, delivery docs, architecture path column, ADRs);
- after merge, the board lane stream and DEVLOG carry one entry naming the PR;
- the GitHub issue is closed by the PR;
- the package exit ticket (W0-09, W1-08) writes `changes/<date>-<package>/review.md` with the exact commands, outputs and fixture identities, and sets the next package's issues to `status:ready`.

Constraints: synthetic data only; no real personal data, credentials or real case documents; no external mail; loopback only; recorded decisions implemented as written; D07-D10 untouched; the frozen source spec unchanged; no time estimates. If a ticket's Done when cannot be met without changing a recorded decision or a spec, the ticket stops and the change is raised to Ta instead of worked around.
