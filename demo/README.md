# Run the True RAI Review Desk demo

From repository root:

```sh
python3 demo/serve.py
```

Open http://127.0.0.1:5173/ in a browser. Stop with Ctrl+C. Python 3 is the only runtime prerequisite; no installation or build step is required.

Use Scenario 1 and BU SPOC to submit the draft. Switch to AI/COE to send the BRD back, then Owner to replace it with v1.1 and resubmit. Approve each lane as its reviewer. The case stays awaiting disposition until the remaining findings are resolved or waived with a reason. Scenarios 2–4 expose the Ready gate, checklist-version isolation and unavailable checks. Admin can publish a simulated configuration revision. Preview controls show the original 1440/834/390 layouts.

Everything is synthetic and kept in memory. Reload or Reset scenario starts over. No real documents are uploaded, no messages are sent, and no production authorization is granted.

The original design is preserved in reference/Main.dc.html. index.html swaps its hosted runtime for runtime.js; layout and component logic are reused, with declared Admin validation corrections in reference/local-adaptations.json. See the [design PRD](../changes/2026-09-21-local-design-demo/PRD.md), [implementation plan](../changes/2026-09-21-local-design-demo/plan.md), [verification](../changes/2026-09-21-local-design-demo/review.md) and [test instructions](../TESTING.md).

Functional acceptance: 22 unit/provenance tests and four browser suites passed after fixes. See the [functional gate](../changes/2026-09-21-local-design-demo/functional-gate.md). Small visual differences are accepted by the owner.
