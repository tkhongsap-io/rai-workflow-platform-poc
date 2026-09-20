# Plan: repository foundation

Date: 2026-09-20. Authorized by: Ta's request to set up the repository and documents; implementation explicitly excluded.

## Files and order

1. Write this intent/spec/plan chain and the Life-OS setup goal.
2. Add README.md, AGENTS.md, DEVLOG.md, CHANGELOG.md, TESTING.md, CONTRIBUTING.md and SECURITY.md.
3. Add docs/product/ (source snapshot, workflow, data contract, decisions), docs/architecture/README.md, docs/security/threat-model.md, docs/evaluation/plan.md, docs/engineering/adoption.md, docs/sources.md, docs/implementation-plan.md and docs/acceptance.md.
4. Add adr/README.md and ADR-0001 recording the documentation-only review-desk boundary. Add .gitignore and .github/PULL_REQUEST_TEMPLATE.md; no CI or starter generation.
5. Verify relative links, source hash, requirement coverage, file types, whitespace and absence of credentials/raw case evidence; record results in review.md.
6. Create private tkhongsap-io/rai-workflow-platform-poc, commit and push this documentation baseline, verify visibility and commit identity.

## Risks and proof

Scope drift into a register: compare L3/L6/L10. Implied launch authority: qualify Ready for launch. Old checklist thresholds: require version identity. Unapproved design choices: label proposals and owners. Source exposure: copy only the explicitly requested product specification, use provenance references for raw cases. GitHub publication is private.

Verification commands and expected outcomes are in [TESTING](../../TESTING.md). Recovery: preserve history, correct documents in a new commit; do not delete the repository or rewrite history automatically.

## Deviations

None at plan creation. Initial plan is committed before the remaining foundation documents. No application code at any step.
