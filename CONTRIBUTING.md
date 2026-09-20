# Contributing

Read [AGENTS](AGENTS.md). Start with an outcome and failure consequence. For substantial changes retain intent → spec → plan → review under changes/<date>-<slug>/. Update source contracts before generated views. Keep diffs small and preserve provenance.

Implementation requires the [start gate](docs/implementation-plan.md). Changes to identity, sensitive data, model access, persistence, deployment, workflow semantics or external actions require an ADR and acceptance updates.

Use Conventional Commits and reviewed branches. Owner authorization is required for commits, pushes, external communications and deployments. Bootstrap permission is not standing publication permission. Self-review is not independent acceptance.

PR evidence must distinguish run locally, run in CI, unavailable and untested. Follow [TESTING](TESTING.md) and [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md). No source or runtime checks may be weakened to obtain a pass.
