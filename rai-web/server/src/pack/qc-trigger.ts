// The W0-07 3.2 `upload` trigger: fired by the save-draft that attaches a stored artifact to a slot, after that
// save's transaction has committed, and only for a slot whose artifact reference actually changed. A bound trigger
// can never hold up, fail or roll back the save: the service calls it after commit, the drain tracks it, and a
// failure is reported as an `error.captured` line only. W4-04 (W4a plan section 5): `createUploadTrigger` runs the
// QC orchestrator's upload run (`runAndPersistUploadQc`); app.ts binds it next to the submit trigger when a runner
// is bound. Slot 9 fires no run (register row "D05 refinement (upload slot 5 and 9)").

import { CURRENT_LANE_MAPPING, type Slot, unavailableOwningLane } from '@rai/shared/constants';
import { StaleVersionError } from '@rai/shared/errors';
import { runAndPersistUploadQc, type QcOrchestratorDeps } from '../qc/orchestrator.js';

export interface UploadTriggerEvent {
  caseId: string;
  draftId: string; // the draft pack_version id (VersionRef.versionId with isDraft: true)
  versionNumber: number;
  slot: number;
  artifactId: string;
  checklistTemplateVersion: string; // selects the threshold source (L12)
  correlationId: string; // W0-10: the save's correlation id, carried to the run
}

export type UploadTrigger = (event: UploadTriggerEvent) => void | Promise<void>;

/** The hook with nothing bound: no upload-time QC run is recorded. */
export const noopUploadTrigger: UploadTrigger = () => undefined;

/**
 * The bound upload trigger. The returned promise settles when the run is recorded (or refused); the pack service
 * tracks it on the drain. A run refused because the version became Ready or was closed by a send-back is an
 * expected workflow race, recorded by the orchestrator itself (`qc.run.late` for Ready), never an internal error.
 */
export function createUploadTrigger(deps: QcOrchestratorDeps): UploadTrigger {
  return async (event) => {
    const slot = event.slot as Slot;
    // Slot 9: no upload rules run, so there is no run and no finding (the orchestrator is never called).
    if (unavailableOwningLane({ trigger: 'upload', slot }, CURRENT_LANE_MAPPING) === null) return;
    try {
      await runAndPersistUploadQc(deps, {
        caseId: event.caseId,
        versionId: event.draftId,
        slot,
        correlationId: event.correlationId,
      });
    } catch (error) {
      if (!(error instanceof StaleVersionError)) throw error;
    }
  };
}
