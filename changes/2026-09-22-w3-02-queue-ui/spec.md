# Queue UI spec

Authority: shared QueueQuerySchema/QueueResponse, delivery W3-02, WORKFLOW_DESIGN and DEVELOPER_HANDOFF; ADR-0003. Reuse existing case cards, badges, forms and bilingual Thai-default locale provider. Cards show source ID, owner display name, current submitted and latest version numbers, submitted lane states/frozen due dates, and the API nextAction as descriptive text, never an approval control. No invented finding counts: the queue contract does not supply them.

Add a protected /queue route. Header primary navigation and signed-in brand point to it; retain /cases, its navigation link, root/sign-in fallback and post-create destination for compatibility until W3-INT. This keeps existing case-list journeys meaningful and avoids making their landing depend on a not-yet-integrated real queue API. Existing case deep links retain RequireSession and API scope checks.

URL query stores search, searchBy, status, owner, useCaseGroup, page and pageSize. Apply form changes explicitly and reset page to 1; page navigation preserves filters. Back/forward/reload restore applied fields. The UI never filters, counts, computes access or invents options: items, counts, options and totals come from the API. Unknown/invalid query values are rejected visibly with reset, never silently widened. Out-of-options URL values remain visible as selected filters but are not treated as authorized options.

Hide stale cards on a new request or session; ignore superseded responses. Accessible loading, retryable errors, empty/no-match states, labels, text statuses, keyboard order and zero critical axe findings at 1440/834/390. Dates use existing Bangkok/Gregorian locale formatting. Real-server acceptance belongs to W3-INT.
