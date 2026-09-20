# Verification

## Current documentation-only gate

Run from repository root:

```sh
git diff --check
git status --short
git ls-files
```

Check every relative Markdown link resolves, including the frozen source's goal pointer. Compare SHA-256 of docs/product/source-spec.md with the first hash in docs/sources.md and the authorized Life-OS source. Confirm acceptance.md includes R1-R10 and L1-L12. Inventory must contain only Markdown and .gitignore (plus Git internal metadata); no application, dependency manifest, executable script, workflow or deployment files.

Portable source hash check:

```sh
python3 -c "from pathlib import Path; import hashlib; print(hashlib.sha256(Path('docs/product/source-spec.md').read_bytes()).hexdigest())"
```

Review semantics as well as file existence: review desk not register; three parallel lanes; version-aware soft QC; human defect dispositions before readiness; unresolved decisions not implied approvals; no fabricated runtime evidence. Check for accidentally copied secrets or raw case evidence. Record actual results and limitations in the change's review.md. Repeat these checks after any documentation correction; verify committed and remote tree identities after publication.

## Future implementation gates

There are no install, build, lint, test or CI commands yet. A stack ADR must define reproducible commands, pinned dependencies and CI only after implementation authorization. Missing runtime checks are not passes.

Use [acceptance.md](docs/acceptance.md) for requirement-level tests, [evaluation/plan.md](docs/evaluation/plan.md) for QC fixtures and thresholds, and [security/threat-model.md](docs/security/threat-model.md) for abuse cases. Unit tests cover state/rule boundaries; integration tests cover persistence, authorization, version immutability and notification delivery; end-to-end tests cover one complete synthetic case and adversarial role access. Repeat relevant tests on every affected change and run the complete agreed release suite before promotion.

Before real-data rehearsal: approve data access, retention and model handling. Before production: independently review security, verify True identity and network controls, rehearse backup/restore and rollback, obtain operator acceptance. Synthetic success is not production acceptance. Logs and artifacts must omit credentials and minimize sensitive case content.
