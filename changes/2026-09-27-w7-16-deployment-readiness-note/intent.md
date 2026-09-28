# Intent: deployment-readiness note (W7-16, #234)

The desk runs today only on a developer's machine. Ta may later host it (Replit is one candidate), and D10 (IT/Security and the accountable owner) will decide the real host, backup target, custody and incident channels. Before anyone tries, the team needs one page that says exactly what a host must provide and what the desk refuses without: how to build and start the one Node 24 process, every configuration key the code reads with its production value or where the value comes from, the three Postgres roles, where uploaded documents live, how secrets arrive, which health endpoints a platform should probe, the operator commands and what they need, and the limits that stop a naive deployment from working.

This ticket writes that page, `docs/engineering/deployment-readiness.md` (W7 plan section 12), and holds it to the code: a unit test fails when the note's configuration table and the keys the server and its commands read drift apart, and when the note's own production values stop passing the server's start-up parse.

It implements the [W7 plan](../../docs/engineering/implementation-plan-w7.md) section 9 row W7-16 and section 12, under the register rows "Ta's delegation (2026-09-27)" and "W7 delegated rulings (provisional)". D10 stays open with its owners: the note names what D10 must decide and chooses none of it.

Not here: any deployment, any host account, any external call, any change to product behaviour, an object-store `BlobStore` (W8/D10), W8 itself. Synthetic data only; nothing is deployed.
