# Specification

Deliverables, all documentation:

1. [`docs/delivery/w4-decision-briefs.md`](../../docs/delivery/w4-decision-briefs.md). One brief for D08 as it bears on W4 and one for D09. Each states why it blocks W4, what the source spec and existing documents already fix, the open questions as a numbered list with two or three labelled options and trade-offs, a recommendation labelled as a proposal, what recording changes and who records it (Ta records; owners approve). One paragraph each for D07 and D10 as later gates. Related questions for Ta outside D08 and D09, including the slot-5/9 upload rule the [#35 spec](../2026-09-25-w2-05-owning-lane/spec.md) defers to W4. A draft W4 gate entry, labelled draft, with its preconditions.
2. [`docs/delivery/w4-work-breakdown.md`](../../docs/delivery/w4-work-breakdown.md). A draft ticket table in the [slice 1](../../docs/delivery/slice-1-work-breakdown.md) house format, headed "Draft — not authorized; becomes Ready only after D08, D09 and Ta's W4 gate entry". Deterministic checks first; the split into W4a and W4b presented as an option for Ta, not a choice. Extraction and model work behind the W0-07 port, upload-trigger QC with the slot-5/9 rule, the evaluation harness and set, probes, ADR-0006 and an exit ticket. A traceability table to A08, A09 and the evaluation plan.
3. Links: the delivery README "Read in this order" list and its path-at-a-glance W4 line (still "not authorized"), and the W4 row of the later-packages outline.

Done when:

- Nothing in the new text says a decision is made; every recommendation is labelled as a proposal.
- No fact about True or CP Group systems is invented; unknowns are named with who would know.
- `node scripts/check-links.mjs` reports 0 broken; `node scripts/check-frozen-source.mjs` passes; `git diff --check` is clean; prettier `--check` passes on the files this change creates.
- BUILD_PLAN.md, docs/product/decisions.md and docs/product/source-spec.md are unchanged.
