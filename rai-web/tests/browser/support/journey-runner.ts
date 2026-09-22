import { ScriptedQcRunner } from '@rai/fixtures/substitutes/qc/index';
import type { QcRunRequest, QcRunResult } from '@rai/shared/qc/types';

/** One runner instance; test-only fault routing never arms competing lane/upload calls. */
export class JourneyQcRunner extends ScriptedQcRunner {
  private submitVersion: string | undefined;

  armSubmitTimeout(versionId: string | undefined): void {
    this.submitVersion = versionId;
  }

  override run(request: QcRunRequest, signal: AbortSignal): Promise<QcRunResult> {
    if (!signal.aborted && request.trigger === 'submit' && request.version.versionId === this.submitVersion) {
      this.submitVersion = undefined;
      this.simulateTimeout('hang', { versionId: request.version.versionId });
    }
    // ScriptedQcRunner consumes its simulation synchronously before its first await.
    return super.run(request, signal);
  }
}
