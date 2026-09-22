# Intent — operator.view policy prerequisite

Activate only the existing Admin-only operator.view rule. W0-05 section 3.2 and test T14, and W0-10 section 7.1 already define its authority. The action name exists in ACTIONS but has no POLICY_ROWS entry, so the new operator endpoint otherwise refuses Admin as well as every other role.

Owner explicitly requested a separate prerequisite commit on 2026-09-22 for parent cherry-pick onto actual main and a separate contract PR. No new role, scope, route, runtime consumer or product decision. The API consumer depends on this prerequisite merging.
