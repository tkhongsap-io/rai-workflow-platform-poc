// @rai/fixtures/substitutes/qc — the W1-10 QC test substitute (W0-07 section 3.9). Selected by QC_MODE=substitute,
// the only slice-1 value; bound in server/src/qc by W2-05. A substitute, never "QC implemented" (W4).
export {
  ScriptedQcRunner,
  materializeFindings,
  type QcHealthAnswer,
  type ScriptedQcRunnerControl,
  type ScriptedQcRunnerOptions,
  type TimeoutMode,
  type TimeoutSelector,
} from './scripted-runner.js';
export {
  BUNDLED_QC_SCRIPTS,
  QcScriptError,
  selectorKey,
  validateScript,
  type QcScript,
  type ScriptEntry,
  type ScriptSelector,
  type ScriptedEvidence,
  type ScriptedFinding,
  type ScriptedScope,
} from './scripts.js';
export { QC_SUBSTITUTE_RUNNER, QC_SUBSTITUTE_RUNNER_VERSION } from './version.js';
