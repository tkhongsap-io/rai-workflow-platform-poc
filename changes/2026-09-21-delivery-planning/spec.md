# Change specification

Done when docs/delivery/ contains:

- an index stating that BUILD_PLAN is canonical, with a ticket status legend;
- team roles, a RACI per package, and explicit limits on AI-agent authority;
- decision briefs for D01, D02, D03 (G0) and D05, D06, D11 (needed during W0-W3). Each brief gives the question, source evidence, options, proposed default labelled as a proposal, decider, evidence format and the tickets it unblocks;
- a W0 contract listing the stack ADR options and scoring criteria without a selection, the interface specs to write with error contracts and test substitutes, and the W0 exit checklist;
- a W1-W3 ticket breakdown. Every ticket cites R/A IDs, dependencies, gating decisions, owner type, inputs, definition of done and evidence;
- a design-to-build map from the handoff screens to tickets and server invariants, listing demo behaviour that is simulation only;
- an agent task-brief template with one worked example;
- a W4-W8 outline, recording source-review observations as candidate backlog, not scope.

Traceability: every W1-W3 exit-evidence item in BUILD_PLAN and every requirement R1, R2, R4-R7 and R9 maps to at least one ticket. R1 is covered only partly in slice 1; production AD remains W8. Every pending decision a ticket depends on is named.

Second pass adds: contract-first and integration tickets (W1-00, Wx-INT), a Lane C for substitutes and CI, a `Done when` column and milestone per package, an explicit merge order, audit/observability/schema/accessibility/language requirements in W0, build principles, delivery risks, a dated status section and decisions-to-lock in BUILD_PLAN, an ADR template and index, an append-only build board with lanes, and an architecture boundary-to-ticket map. Structure mirrors s42-ci-platform where the RAI stage allows; calendar dates, sizes and live runtime state are not adopted.

Constraints: Markdown only. No code, manifests, CI or deployment files. Frozen source-spec bytes unchanged. No real case content copied from Life-OS; cite paths only. No staffing dates or estimates invented. First pass: pointer edits only in BUILD_PLAN, README, DEVLOG, CHANGELOG and adr/README. Second pass may additionally edit BUILD_PLAN (principles, risks, dated status, decisions-to-lock, one W7 entry bullet), AGENTS.md (agent rules, branch naming), PRD.md (R1 package column), docs/acceptance.md (proposed A11, audit tampering), docs/architecture/README.md (boundary map), docs/product/decisions.md (proposed D12 row), data-contract.md and workflow.md (provisional fields, D05 gate wording), and create adr/TEMPLATE.md and docs/board/. Package text W0-W8 in BUILD_PLAN is not rewritten.
