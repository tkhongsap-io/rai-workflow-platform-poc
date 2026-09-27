# Intent: restore and verify (W7-02, #216)

W7-00 needs a recorded backup and restore rehearsal on synthetic data before any real case is loaded (BUILD_PLAN W7): full case history, artifact bytes and audit trail restored and re-verified against A07. W7-01 made the backup. Nothing yet turns a backup back into a working desk or proves the copy is faithful. This ticket adds the second half:

- `npm run restore -- --from <backupDir> --target-db <name> --blob-dir <dir>` restores a backup into a **new** database and a **new** blob directory, never the live ones (W7-D7), after checking the dump against its manifest hash.
- `npm run restore:verify -- --from <backupDir> --target-db <name> --blob-dir <dir>` re-proves the restored copy: migration journal, row counts, the frozen-evidence digest, every submitted version's manifest hash, blob bytes, A07 (a frozen slot cannot be changed as `rai_app`), A11 (audit rows cannot be changed as `rai_app` or `rai_owner`) and the `rai_app` `DELETE` grant rule.

The integration test runs a real journey (submit, lane QC, disposition, send back, resubmit, decide), backs it up, restores it, verifies it, and then starts the real server on the restored copy to read versions 1 and 2, their findings and decisions, and download one artifact byte-identical. Tampered blobs, a tampered dump, tampered evidence rows and a stray `DELETE` grant each fail the named check.

It implements the [W7 plan](../../docs/engineering/implementation-plan-w7.md) section 3.2, the section 2 key `DATABASE_ADMIN_URL` and the section 8 restore events, under the register rows "Ta's delegation (2026-09-27)" and "W7 delegated rulings (provisional)" (W7-D6, W7-D7). The CI integration job gains one `DATABASE_ADMIN_URL` line (lead-reviewed).

Not here: rollback check (W7-03, merged), runbooks (W7-04), the recorded rehearsal (W7-13). The production backup target, schedule and host are D10's (working assumption: none). Synthetic data only; no external network call; nothing is deployed.
