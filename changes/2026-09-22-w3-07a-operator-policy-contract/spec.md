# Contract

operator.view has exactly one policy row: role admin, scope all_cases. Existing policy evaluation enforces it. Non-Admin actors, including combined owner/reviewer grants, remain forbidden; no session remains the existing middleware's 401 rule. Admin gains no lane-decision authority from this row.

Authority: [W0-05 authorization matrix](../../docs/engineering/authorization-policy-matrix.md), section 3.2 and T14; [W0-10 observability](../../docs/engineering/observability-contract.md), section 7.1. W0-05's shared-row contract gate requires this separate prerequisite; an existing action declaration does not waive that gate.
