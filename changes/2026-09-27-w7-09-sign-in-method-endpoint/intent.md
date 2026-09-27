# Intent: sign-in method endpoint and UI (W7-09, #218)

Outside `fixture` mode the sign-in screen shows one provider button, and today it always says "Sign in with Google (this machine only)", because the SPA's only signal is that `GET /auth/fixture/users` answered 404. In `network` mode (W7-05) the provider is the organisation's OIDC issuer, so the label and note are wrong, and a rehearsal participant would be told they sign in with Google on this machine.

This ticket, under the [W7 plan](../../docs/engineering/implementation-plan-w7.md) sections 6 and 7 and section 9 row W7-09, and the register rows "Ta's delegation (2026-09-27)" and "W7 delegated rulings (provisional)":

- adds a public `GET /auth/sign-in-method` answering `{ method: 'fixture' | 'google' | 'organization' }` from the identity adapter's mode (`network` and `production` both answer `organization`), with no issuer, client or tenant value;
- makes the sign-in screen, after the fixture-users 404, read that route and label the provider button and note for Google or for the organisation;
- adds the th and en keys `auth.sign_in_with_organization` and `sign_in.organization_note`;
- amends W0-02 section 7.2 with the route.

Not here: production identity (W8), any change to the OIDC flow, the fixture picker or the W1-13 API substitute (the SPA reads the new route only after the fixture-users 404, which the substitute never answers). Synthetic data only; no external network call; nothing is deployed.
