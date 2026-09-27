// W4a plan section 2 / 6: the QC kind reported for a run (qc.run.started `qcKind`) comes from the bound runner's
// identity, never a constant. Runner `deterministic` is the W4a runner; every other runner bound in W0-W4a (the W1-10
// `substitute-scripted` runner and the test-only probes of the start.ts override) is synthetic, so `substitute`.
import type { QcRunner } from '@rai/shared/qc/types';
import type { ReadinessReport } from '@rai/shared/schemas/observability';

export const DETERMINISTIC_RUNNER = 'deterministic' as const;

export function qcKindOf(identity: QcRunner['identity']): ReadinessReport['qc']['kind'] {
  return identity.runner === DETERMINISTIC_RUNNER ? 'deterministic' : 'substitute';
}
