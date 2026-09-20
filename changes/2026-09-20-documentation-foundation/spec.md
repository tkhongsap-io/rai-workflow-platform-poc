# Foundation specification

## Current state and gaps

New repository; no application, languages, services, models, runtime, CI or production environment selected. The upstream product spec exists in Life-OS. No operator confirmation was supplied. Prior AI Console descriptions calling this a canonical register are superseded by the current review-desk specification.

## Deliverable

Root context/control/verification documents, a product contract, technology-neutral architecture, workflow/data/security/QC contracts, requirement-to-acceptance traceability, ADRs, a staged implementation plan and a pinned playbook adoption profile. Source hashes identify exactly which documents were read. Raw submitted cases and sensitive attachments are not copied.

## Acceptance

1. Requested private GitHub repository exists; remote main equals local HEAD.
2. All relative Markdown file links resolve.
3. R1-R10 and L1-L12 are present in the captured product source, with downstream acceptance coverage.
4. Only Markdown and repository metadata exist; no executable code, dependency manifest or CI workflow.
5. Source snapshot reproduces its original bytes; other evidence has paths and hashes.
6. Open decisions and implementation lock appear in README, AGENTS and implementation plan.

## Scope authority

[Product source](../../docs/product/source-spec.md) governs behavior. [Adoption profile](../../docs/engineering/adoption.md) pins the engineering baseline. Technical refinements are proposals until approved, never silent modifications of source rules.
