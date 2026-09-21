// The W0-07 3.2 `upload` trigger hook point: fired by the save-draft that attaches a stored artifact to a slot,
// after that save's transaction has committed, and only for a slot whose artifact reference actually changed. The
// orchestrator that turns this into a `QcRunRequest` (W0-07 3.4, `server/src/qc/`) and the W1-10 substitute it
// binds are not part of this ticket; the server registers `noopUploadTrigger` until they land (W2-05 / W4). A
// bound trigger can never hold up, fail or roll back the save: the service calls it after commit and reports a
// failure as an `error.captured` line only.

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

/** Slice 1 without an orchestrator: the hook exists, nothing runs. QC is not implemented (W4). */
export const noopUploadTrigger: UploadTrigger = () => undefined;
