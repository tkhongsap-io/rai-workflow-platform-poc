# Design-to-build map

Maps each designed surface in the [developer handoff](../design/DEVELOPER_HANDOFF.md) to the tickets that build it, the server invariant it depends on, and the acceptance test that proves it.

The design is the **UI contract**: layout, copy, states and journey order. The [workflow](../product/workflow.md) and [data contract](../product/data-contract.md) are the **server contract**. The `demo/` code is disposable reference ([ADR-0002](../../adr/0002-local-design-demo.md)), not the frontend codebase. Its client-side permissions are not security controls.

| Surface | Tickets | Server invariant the UI relies on | Acceptance |
|---|---|---|---|
| Review queue | W1-07 (own list), W3-01, W3-02 | Cards, counts, filter options and notification links are all scoped on the server | A06, A01 |
| New case | W1-02, W1-07 | External register is never written; `source_record_id` is a known ID or `Unknown`; `checklist_template_version` is recorded on the pack version and keys QC thresholds (L12, W1-04); the design's model-version, vendor and model-type inputs have no confirmed data-contract field yet (see data contract, proposed fields) | A02 |
| Case / Documents | W1-04, W1-05, W1-06 | Submit freezes documents and configuration; soft QC never blocks submit | A02, A07 |
| Review lanes | W2-01, W2-02, W2-07 | Actors act only in their own lane; each decision is bound to the current submitted version | A04, A09, A01 |
| Findings | W2-05, W2-06, W2-07, W2-09 | Ready requires every finding dispositioned; waived and N/A need reasons and are recorded by the owning lane; the owner's "fixed" is confirmed by that lane (D05) | A09 |
| History | W1-05, W2-03, W2-07 | Prior documents, decisions and config are never rewritten | A07 |
| Notifications | W3-03, W3-04 | Sent only after commit; a link never grants access on its own | A05 |
| Administration | W6 (not slice 1) | New config applies to later submissions only; Admin cannot approve | A10 |

## Demo behaviour that is simulation only

Rebuild each of these server-side. Do not port them.

| In the demo | In the product |
|---|---|
| Role switcher in the top bar | Real sign-in through the identity adapter (W1-01). No role switching in the product UI. |
| Scenario selector and Reset | Synthetic fixtures loaded in test and dev environments only (W0-08) |
| In-memory state, reset on reload | Persistent store with immutable versions (W1-05) |
| Canned attachments and "sample change" | Real upload with safety checks (W1-03) |
| Synthetic QC findings, risk tier and "unavailable" scenario | QC substitute in slice 1 (W2-05); real QC in W4; risk in W5 |
| Notification drawer previews | Local mail sink (W3-03); real mail only after W7 authorization |
| Preview width controls (1440/834/390) | Responsive production UI; keyboard, focus, contrast and overflow are owned by the `Done when` of W1-06, W1-07, W2-07, W2-09 and W3-02 under the W0-02 UI quality bar |
| Admin revision publish | W6 with audit history and activation rules |

## Carry forward from the design

- Status always combines text and colour. Case identity, submission version and next action stay prominent.
- Findings are shown before the approve and send-back actions.
- Three equal lane cards; documents, findings and history as rows, not nested cards.
- Brand tokens from the handoff are proposed accessible adaptations, not a certified brand kit. Contrast of the implemented tokens is verified in the UI tickets' `Done when`.
- Copy is bilingual with Thai default (D12); every string carries a locale key.
- "Ready for launch" is the current label and means desk completion only. "Review complete" is a suggested label and has not been approved.
