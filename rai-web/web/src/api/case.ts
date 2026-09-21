// The W0-02 section 7 calls the case flow uses (W1-06): session (7.2), case and configuration (7.3), artifact
// upload and metadata (7.4), pack draft (7.5), submit and version navigation (7.6). Shapes come from @rai/shared;
// the substitute (W1-13) and the server (W1-02 to W1-05) answer the same paths.

import type { SessionInfo } from '@rai/shared/schemas/auth';
import type { CaseView, ConfigurationView } from '@rai/shared/schemas/cases';
import type { ArtifactRef } from '@rai/shared/schemas/artifacts';
import type { PackDraft, PackDraftUpdateRequest } from '@rai/shared/schemas/pack';
import type { SubmitRequest, SubmittedVersion, VersionListResponse } from '@rai/shared/schemas/versions';
import { request } from './client.js';

const enc = encodeURIComponent;

export function getSession(): Promise<SessionInfo> {
  return request<SessionInfo>('/api/session');
}

export function getConfiguration(): Promise<ConfigurationView> {
  return request<ConfigurationView>('/api/configuration/current');
}

export function getCase(caseId: string): Promise<CaseView> {
  return request<CaseView>(`/api/cases/${enc(caseId)}`);
}

export function getDraft(caseId: string): Promise<PackDraft> {
  return request<PackDraft>(`/api/cases/${enc(caseId)}/draft`);
}

export function saveDraft(caseId: string, body: PackDraftUpdateRequest): Promise<PackDraft> {
  return request<PackDraft>(`/api/cases/${enc(caseId)}/draft`, { method: 'PUT', json: body });
}

/** One part named `file`; nothing else is read (W0-08 section 3). Idempotent by content hash: no key. */
export function uploadArtifact(caseId: string, file: File): Promise<ArtifactRef> {
  const form = new FormData();
  form.append('file', file, file.name);
  return request<ArtifactRef>(`/api/cases/${enc(caseId)}/artifacts`, { method: 'POST', form });
}

export function getArtifactMeta(artifactId: string): Promise<ArtifactRef> {
  return request<ArtifactRef>(`/api/artifacts/${enc(artifactId)}/meta`);
}

export function listVersions(caseId: string): Promise<VersionListResponse> {
  return request<VersionListResponse>(`/api/cases/${enc(caseId)}/versions`);
}

export function getVersion(caseId: string, versionId: string): Promise<SubmittedVersion> {
  return request<SubmittedVersion>(`/api/cases/${enc(caseId)}/versions/${enc(versionId)}`);
}

/** W0-06 5.3: the key is a UUID minted per user action; a replay returns the original 201. */
export function submitDraft(
  caseId: string,
  body: SubmitRequest,
  idempotencyKey: string,
): Promise<SubmittedVersion> {
  return request<SubmittedVersion>(`/api/cases/${enc(caseId)}/draft/submit`, {
    method: 'POST',
    json: body,
    idempotencyKey,
  });
}
