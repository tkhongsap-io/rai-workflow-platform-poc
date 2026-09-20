# ADR-0001: review-desk documentation foundation

Date: 2026-09-20. Status: accepted for documentation setup by Ta's current request; product/operator acceptance remains pending.

## Context

The current Life-OS v1 spec defines a review desk. Older AI Console language suggested a register and eight-stage lifecycle. Ta now requests a corresponding repository with documents first and no code.

## Options

1. Reuse Life-OS as the application repository: mixes personal knowledge and application delivery.
2. Generate a full stack starter immediately: violates the explicit no-code and deferred-stack boundary.
3. Create a private standalone documentation foundation: establishes engineering context while retaining implementation gates.

## Decision

Choose option 3, named rai-workflow-platform-poc under tkhongsap-io. Preserve a hashed v1 source snapshot and pinned playbook references. Implement no application code. The current request supersedes the earlier idea's project-location timing for documentation setup only; it does not satisfy the application-start gate.

## Consequences and revisit

No executable first-run experience exists yet. Proposed architecture and tests must be reviewed before code. Ready for launch is a review-desk status, not external governance clearance. Revisit if the owner changes scope, asks for official-register ownership or authorizes implementation; record a successor ADR rather than silently changing this decision.
