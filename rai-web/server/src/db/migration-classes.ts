// W7-03 (W7 plan section 3.3; W0-04 "Schema evolution"; register row "W7 delegated rulings (provisional)", W7-D8
// and W7-D9): the rollback class of every migration in server/drizzle/.
//   additive          the previous release still runs against this schema (readiness `ahead`, binary-only rollback)
//   restore-required  rolling back means restoring the pre-migration backup and redeploying the previous release
//   copy-forward      a reshaping that copied data into a new table or column and left the original in place
// `npm run migrate` records these values in schema_migration_class; readiness and release:check-rollback read the
// table, never this map (an older build's map does not know newer tags). migration-classes.test.ts fails when a
// migration has no entry, or when a migration from W7-03's own on has no `-- rollback expectation: <class>;` header
// equal to its entry. Migrations merged before W7-03 keep their headers (0007 and 0009 say "forward repair only",
// which is not a W0-04 value) and take their class from here.

export const ROLLBACK_CLASSES = ['additive', 'restore-required', 'copy-forward'] as const;
export type RollbackClass = (typeof ROLLBACK_CLASSES)[number];

export function isRollbackClass(value: unknown): value is RollbackClass {
  return typeof value === 'string' && (ROLLBACK_CLASSES as readonly string[]).includes(value);
}

export const MIGRATION_CLASSES: Readonly<Record<string, RollbackClass>> = Object.freeze({
  '0000_w1_00_substrate': 'additive',
  '0001_w1_01_session': 'additive',
  '0002_w1_09_fixture_set': 'additive',
  '0003_w1_02_registry_counter': 'additive',
  '0004_w2_01_notification': 'additive',
  '0005_w2_02_lane_decision': 'additive',
  '0006_w2_05_findings_dispositions': 'additive',
  // W7-D9: conservative, kept at W7-03. 0007's deferred trigger `digest_requires_job` refuses a new SLA digest
  // notification without an operator_job_notification link, which a pre-W3-07a build never writes, so that build's
  // digest job would fail against this schema. Its header says "forward repair only".
  '0007_w3_07a_observability': 'restore-required',
  '0008_w3_hardening_lane_decision_scopes': 'additive',
  // W7-D9: qc_run.runner_version is NOT NULL with no default, so a pre-W4-11a build cannot insert a QC run.
  '0009_w4_11a_run_identity': 'restore-required',
  // W5-03 (merged before W7-03): its header says restore-required (an older binary cannot serialize risk_tier
  // 'unknown'); added here when W7-03 rebased onto it (W7 plan section 9.1).
  '0010_w5_03_risk': 'restore-required',
  '0011_w7_03_migration_class': 'additive',
});

/**
 * The tag suffix of the W7-03 migration (0011 since the rebase onto W5-03; a rebase may change the number, never the
 * suffix). A build whose journal carries it answers readiness `ahead`; a build before it answers `unknown` for any
 * longer journal, so binary-only rollback is possible only to a build at or after W7-03 (W0-04 amendment, plan 3.3).
 */
export const AHEAD_READINESS_TAG_SUFFIX = '_w7_03_migration_class';

/** The value of the first `-- rollback expectation: <value>;` header line, or undefined when there is none. */
export function headerRollbackClass(sql: string): string | undefined {
  const match = /^-- rollback expectation: ([^;\n]+);/m.exec(sql);
  return match?.[1]?.trim();
}

export type MigrationClassErrorCode =
  'migration_journal_mismatch' | 'migration_class_missing' | 'migration_class_changed';

/** Raised by the class writer; the message is the code only (no tag, hash or path). */
export class MigrationClassError extends Error {
  constructor(readonly code: MigrationClassErrorCode) {
    super(code);
    this.name = 'MigrationClassError';
  }
}
