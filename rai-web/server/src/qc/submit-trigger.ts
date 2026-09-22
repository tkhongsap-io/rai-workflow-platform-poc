// The transaction has resolved before this hook is called. QC cannot change the HTTP/business result.
import { runAndPersistSubmitQc, type QcOrchestratorDeps, type RunSubmitQcInput } from './orchestrator.js';
import type { Drain } from '../shutdown.js';
import { StaleVersionError } from '@rai/shared/errors';

export function createSubmitTrigger(deps: QcOrchestratorDeps, drain: Drain) {
  return (input: RunSubmitQcInput): void => {
    const task = Promise.resolve()
      .then(() => runAndPersistSubmitQc(deps, input))
      .then(() => undefined)
      .catch((error: unknown) => {
        // The orchestrator records a late-after-Ready refusal itself; that expected
        // workflow race is not an additional internal-error event.
        if (!(error instanceof StaleVersionError)) deps.errors?.internal(error);
      });
    drain.track(task);
  };
}
