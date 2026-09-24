// The W0-07 3.2 `upload` trigger hook point: fired by the save-draft that attaches a stored artifact to a slot,
// after that save's transaction has committed, and only for a slot whose artifact reference actually changed. A
// bound trigger can never hold up, fail or roll back the save: the service calls it after commit and reports a
// failure as an `error.captured` line only. The server binds `noopUploadTrigger` because the QC orchestrator runs
// only the `submit` and `approve_attempt` triggers; per-upload QC on a draft is W4 (version-aware soft QC), which
// is not authorized.

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
