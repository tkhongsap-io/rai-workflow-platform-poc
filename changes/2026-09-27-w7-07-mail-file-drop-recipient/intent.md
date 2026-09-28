# Intent: mail file drop, recipient and BU directories (W7-07, #225)

Outside `fixture` mode the desk sends no mail at all. `start.ts` binds a mail sink only in `fixture` mode (the sinks live in `@rai/fixtures`, which a production build cannot contain), so a configured `local-google` or `network` desk reports mail `unavailable` and readiness 503 (W3 deferred ruling item 6). Even with a sink, nobody would be addressed: lane-open, send-back and ready recipients come only from the fixture identity table, and the business units a SPOC can hold come only from the fixture list.

Under the [W7 plan](../../docs/engineering/implementation-plan-w7.md) section 5.3 and section 9 row W7-07, and the register rows "Ta's delegation (2026-09-27)" and "W7 delegated rulings (provisional)" (W7-D11 option A, W7-D12 option A, W7-D20 option B), this ticket makes a `local-google` or `network` desk usable end to end on synthetic data:

- an in-product **mail file drop** (`MAIL_MODE=sink-file`) that writes each message as JSON plus text, exactly as the fixture `FileMailSink` names and shapes them, validates, answers `duplicate` across restarts and never sends anything;
- the shared delivery contract (`validateDeliveryRequest`, `mailFileStem`) moves into `@rai/shared`, with the fixtures re-exporting it unchanged;
- an in-memory **recipient directory** loaded from `subject_profile` at start and refreshed after each committed sign-in (the W7-06 hook), so a person who signed in once receives the mail their role snapshot entitles them to;
- the identity adapter exposes the **configured role grants** (never emails), whose business units join the BU directory.

Not here: real mail, real addresses (the synthetic-address rule stays; relaxing it is D08-gated), the A01 network suite (W7-08), W8. Synthetic data only; no external network call; nothing deployed.
