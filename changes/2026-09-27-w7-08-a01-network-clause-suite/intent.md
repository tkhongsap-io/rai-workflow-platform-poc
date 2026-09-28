# Intent: A01 network clause suite (W7-08, #233)

A01 says every role sees only what it is authorized to see, including by direct URL and API, and that networked access requires an allow-list (or AD). Until now every A01 negative ran in `fixture` mode, and `network` mode was proven only by parse and start-up refusal rows (W7-05). Nothing showed that a desk running in `network` mode, with people signing in through an OIDC provider and roles from the allow-list, enforces the same boundaries.

Under the [W7 plan](../../docs/engineering/implementation-plan-w7.md) section 5.2 and section 9 row W7-08, and the register rows "Ta's delegation (2026-09-27)" and "W7 delegated rulings (provisional)" (W7-D1: the `network` path is proven by this suite; W7-D2 working assumption: no non-loopback bind in any test; W7-D3: `allow-list` source), this ticket adds an integration suite that runs the desk in `network` mode on loopback, against the real Postgres and the real HTTP stack, with a synthetic OIDC issuer supplied through the existing `discovery` and `exchange` seams, and proves the seven items of section 5.2: readiness, allow-listed sign-in, refusal of unlisted and unverified accounts, the per-role direct-URL and API negatives, an allow-list change applying only at the next sign-in, the cross-site guard, and the `https` start-up rule.

It then names this suite as the evidence for W0-03 ID-16, adds the A01 network-clause evidence line to `docs/acceptance.md`, and links it from the threat-model row "Networked test exposed with arbitrary Google login".

Not here: a non-loopback bind (D10), a real IdP or any external call, the `ad` source (W7-D3), production identity (W8), any product-code change. Synthetic data only; nothing deployed.
