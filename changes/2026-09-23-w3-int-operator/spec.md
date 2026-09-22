# Evidence contract

Authority: [W0-10](../../docs/engineering/observability-contract.md), OBS-09/10/12/17 and section 7; parent-approved INT plan in Heisenberg's integration branch (read 2026-09-23, not copied into this branch).

- Produce a committed send-back through the real workflow, then let the existing dispatcher exhaust four attempts against the configured failing local sink. Match its notification ID and correlation between persisted/report evidence, three attempt-failed logs and one terminal mail.failed log. Never write delivery state directly.
- Produce a timeout through the real submit-trigger worker using the configured synthetic runner. Match its unavailable QC run and correlation between the actual report and qc.run.unavailable log. No manufactured finding or owning lane; unresolved issue #35 remains outside claimed proof.
- As Admin, open the actual operator page and verify each target appears exactly once in its own section with its matching read-only correlation field. Identify records by IDs, not by total list length or a coincidental shared recipient.
- As owner, the page shows localized forbidden and exposes no operator records; the direct operator API returns 403. Without a session it returns 401. Use actual responses, never fulfilled interception payloads.
- Exercise keyboard navigation, Refresh and correlation selection with visible focus, Thai/English labels and axe at 1440/834/390. Assert report contents remain correct after refresh. Reuse existing helpers and locale keys.
- Test controls may select failure behavior only through Heisenberg's committed test-owned harness. No control endpoint, production environment backdoor, extra worker, fixed sleep or private React-state injection.

This sidecar does not establish production permission, full W3-INT completion, performance acceptance or resolve #35.
