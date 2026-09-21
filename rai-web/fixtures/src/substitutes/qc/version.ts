// The W0-04 `qc_run.engine_id` value and the runner version stamped on every scripted finding's provenance.
// The version equals the @rai/fixtures package version (W0-07 3.9 "runnerVersion: <package version>"); the
// colocated test asserts it against package.json, since this module reads no file.

export const QC_SUBSTITUTE_RUNNER = 'substitute-scripted' as const;
export const QC_SUBSTITUTE_RUNNER_VERSION = '0.0.0' as const;
