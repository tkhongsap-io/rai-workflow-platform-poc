# W3-INT planning review

Planning only. Created isolated branch `codex/w3-int` at exact main `fe65fc1`. Read W3-INT/#49, W3-06/#50, #35, W0-10 OBS requirements and W3-07a reconciliation; inspected existing real-server harness, API-substitute configuration and current owner API snapshots read-only. No application/test code, dependencies, database or acceptance run changed. Proposed paths and ports require lead review before implementation.

The plan explicitly includes submit timeout and late-after-Ready QC evidence, actual Admin data/correlation, and full API-substitute removal from app configuration while retaining permitted synthetic QC/mail adapters. #35 and production gates remain open. Queue UI authorship disqualifies this agent from being the sole final independent integration reviewer.

Parent steering added the explicit CI-only OBS_MIGRATION_ADMIN_URL opt-in and a mandatory non-skipped historical upgrade result. Inspected the existing test: it skips if the variable is absent, creates/drops its own random database, and verifies upgrade/provenance/dedup/late-QC constraints. Parent reports 1/1 pass, no skip on fe65fc1/54366; not rerun here. Main queue UI merge ec2c99b is noted without rebasing this worktree.

Planning checks: relative Markdown links and frozen source hash passed; git diff --check passed. No runtime, browser or database tests executed in this planning assignment.
