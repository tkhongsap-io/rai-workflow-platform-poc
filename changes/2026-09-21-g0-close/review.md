# Review: G0 closed and build documents finalized

2026-09-21. Author self-review plus a multi-agent verification run; not independent acceptance.

## What was recorded

Ta's instruction after speaking with Nakhun: accept the proposed defaults and start the build. Recorded in docs/product/decisions.md with approver, date and channel:

- **D01** (Nakhun, confirmed to Ta): review desk, operator, DPO 3 working days.
- **D02** (Ta): BRD; AI/COE lane = slots 1 and 5; lane mapping is a versioned constant.
- **D03** (Ta): W0-W3 authorized on synthetic data; `codex/<ticket-id>-<topic>` branches; one ticket per PR; Ta merges; GitHub issues as tracker.
- **D05, D06, D11, D12** (Ta): the brief defaults, verbatim in the register.

Open: D04 (inside W0-01), D07-D10. The frozen source spec was not edited; its open AI/COE item is resolved by the register.

## What changed

Register restructured into recorded and open tables. Propagated to PRD (status, authority, journey step 5, document pack, SLA, non-goals), workflow.md, data-contract.md, acceptance.md (A04-A07, A09, L9 row), BUILD_PLAN (header, G0, W0/W2/W3 entries, decisions recorded, status table, risks, closing line), AGENTS (authorization and PR rules), README, CONTRIBUTING, TESTING, docs/implementation-plan.md, docs/sources.md, docs/engineering/adoption.md, the design handoff and storyboard, and the whole delivery pack (README, briefs, W0 contract, slice-1 breakdown, team-and-roles, design map, later packages, agent brief). DEVLOG, CHANGELOG and the decisions board lane record the event.

## Verification workflow (`wf_ac604d57-a39`, 42 agents)

Four checkers (stale markers, contradictions, workflow alignment, build readiness), one skeptic per finding: 38 findings, 31 confirmed, 7 refuted. All 31 applied. The substantive ones:

- Stale "not authorized / resolve G0 / pending" sentences on the engineer's entry path removed from BUILD_PLAN, DEVLOG, implementation-plan pointer, CONTRIBUTING, README, adoption profile, sources, design handoff and storyboard; AGENTS now states the D03 PR rule.
- **Owning-lane assignment** for findings: `owning_lane` added to the finding contract (W0-07, data contract); single-lane slots assigned by mapping; shared BRD, slot 9, pack-level and QC-unavailable findings named as a D05 refinement the review leads record in W0-06 before W2-05.
- **No-self-approval** now tested: a dual-role fixture identity (W0-03, W1-00), negatives in W2-02, W2-08 and the BUILD_PLAN/acceptance exit text.
- **Inherited status fields** (`privacy_status` etc.): W0-04 confirms whether they are workflow projections or reference copies; never a second record of a decision (data contract, W1-02).
- **W1 interface shapes** now have a home: a W0-02 section that W1-13 serves and Lane B builds against; W2/W3 shapes added by contract PRs.
- Positive tests added for Google sign-in on loopback (W1-08, manual, no account recorded), known TPM-/VRO- IDs and BU SPOC submitting on the owner's behalf (W1-02, W1-INT).
- Ownership fixes: `operator_recipients` seeded by W1-00; W0-02 owns the TESTING.md edit; W1-00 creates the sample env; Ta accepts the synthetic upload policy at W0 exit if IT/Security is unnamed; the tech lead opens the GitHub issues.

Refuted (not applied): W0-05's BU SPOC "propose fixed" (source spec says SPOC acts as the owner); register affected-document lists vs ticket columns (informational); a pending-"fixed" queue indicator (UI detail for W2-09); notification recipient wording (already scoped by W0-05); exit tickets over-claiming A02/A09 QC clauses (W4 is named); register channel sentence blocking D04 (D04 gets its own row with its own channel).

## Checks after the edits

- `git diff --check`: clean.
- Source-spec SHA-256: `92c4f7123058b8fe…` unchanged, matches docs/sources.md.
- Relative links: 225, 0 broken after this file was written.
- `node --test tests/*.test.mjs`: 22 pass, 0 fail.
- Ticket IDs: 45 defined, 0 undefined references.
- Stale-marker grep over the entry path: only ADR-0001 (a dated 2026-09-20 record, kept as history).

## Limits

Nakhun's D01 confirmation was verbal to Ta; the register cites Ta's instruction as the channel. Review leads still record the owning-lane refinement before W2-05. Nothing is committed or pushed; W0-01 has not started.
