// W1-07 (Lane B): the typed client over @rai/shared (W0-02 section 1: "the only place fetch is called"). It speaks
// the section 7 shapes to whatever answers /api and /auth on the same origin: the real server (W1-INT) or, behind
// the Vite proxy, the W1-13 substitute. It never decides access: every 401/403 arrives here as an ApiError carrying
// the W0-06 8.2 envelope and the screens render what they were told (section 1.1 "the SPA never decides access").
// W1-06 adds the case-flow calls: the pack draft (7.5), artifact upload as multipart with one `file` part and
// artifact metadata (7.4), submit and version navigation (7.6).

import {
  isErrorCode,
  type ErrorCode,
  type ErrorDetails,
  type ErrorResponse,
  type FieldError,
} from '@rai/shared/errors';
import type { CorrelationId, LocaleKey } from '@rai/shared/ids';
import type {
  FixtureSignInRequest,
  FixtureUsersResponse,
  SessionInfo,
  SessionLocaleRequest,
  SignInRequest,
  SignInResponse,
} from '@rai/shared/schemas/auth';
import type { ArtifactRef } from '@rai/shared/schemas/artifacts';
import type {
  CaseCreateRequest,
  CaseListQuery,
  CaseListResponse,
  CaseView,
  ConfigurationView,
} from '@rai/shared/schemas/cases';
import type { QueueQuery, QueueResponse } from '@rai/shared/schemas/queue';
import type { PackDraft, PackDraftUpdateRequest } from '@rai/shared/schemas/pack';
import type {
  ApproveLaneRequest,
  DispositionRequest,
  DispositionResponse,
  LaneDecisionResponse,
  LaneQcRunRequest,
  LaneQcRunResponse,
  SendBackLaneRequest,
  VersionFindingsResponse,
} from '@rai/shared/schemas/review';
import type { Lane } from '@rai/shared/constants';
import type { SubmitRequest, SubmittedVersion, VersionListResponse } from '@rai/shared/schemas/versions';

export const API_PATHS = Object.freeze({
  session: '/api/session',
  sessionLocale: '/api/session/locale',
  signIn: '/auth/sign-in',
  signOut: '/auth/sign-out',
  fixtureUsers: '/auth/fixture/users',
  fixtureSignIn: '/auth/fixture/sign-in',
  cases: '/api/cases',
  queue: '/api/queue',
  configuration: '/api/configuration/current',
  artifacts: '/api/artifacts',
});

const enc = encodeURIComponent;

/** The download URL of an artifact (W0-02 7.4); the server answers 401 without a session even for a copied link. */
export function artifactDownloadPath(artifactId: string): string {
  return `${API_PATHS.artifacts}/${enc(artifactId)}`;
}

/** The W0-06 8.2 envelope as a thrown error; `messageKey` is a locale key the screen renders (D12). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'internal_error' | 'unknown',
    readonly messageKey: LocaleKey,
    readonly correlationId: CorrelationId | undefined,
    readonly details: ErrorDetails[ErrorCode] | undefined,
  ) {
    super(`${status} ${code}`);
    this.name = 'ApiError';
  }

  get fieldErrors(): FieldError[] {
    if (this.code !== 'invalid_input' || this.details === undefined) return [];
    const details = this.details as ErrorDetails['invalid_input'];
    return Array.isArray(details.fields) ? details.fields : [];
  }

  /** The `stale_version` details (W0-06 8.2: guidance key, current version, refresh path), or undefined. */
  get stale(): ErrorDetails['stale_version'] | undefined {
    if (this.code !== 'stale_version' || this.details === undefined) return undefined;
    return this.details as ErrorDetails['stale_version'];
  }
}

/** The server could not be reached or answered something that is not JSON. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('network');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

export interface RequestOptions {
  body?: unknown;
  /** A multipart body (uploads, W0-02 7.4); the browser sets the boundary. Mutually exclusive with `body`. */
  form?: FormData;
  idempotencyKey?: string;
  query?: Record<string, string | number | undefined>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function isEnvelope(value: unknown): value is ErrorResponse {
  if (typeof value !== 'object' || value === null) return false;
  const error = (value as { error?: unknown }).error;
  return (
    typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string'
  );
}

export async function toApiError(response: Response): Promise<ApiError> {
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    parsed = undefined;
  }
  if (isEnvelope(parsed)) {
    const { code, messageKey, correlationId, details } = parsed.error as {
      code: string;
      messageKey: string;
      correlationId: string;
      details?: ErrorDetails[ErrorCode];
    };
    const known = isErrorCode(code) ? code : code === 'internal_error' ? 'internal_error' : 'unknown';
    return new ApiError(response.status, known, messageKey, correlationId, details);
  }
  return new ApiError(
    response.status,
    'unknown',
    'error.internal_error',
    response.headers.get('x-correlation-id') ?? undefined,
    undefined,
  );
}

export function createApiClient(fetchImpl: FetchLike = (input, init) => fetch(input, init)) {
  async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    let body: BodyInit | undefined;
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.body);
    } else if (options.form !== undefined) {
      body = options.form;
    }
    if (options.idempotencyKey !== undefined) headers['idempotency-key'] = options.idempotencyKey;
    let url = path;
    if (options.query !== undefined) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined) params.set(key, String(value));
      }
      const qs = params.toString();
      if (qs !== '') url = `${path}?${qs}`;
    }
    const init: RequestInit = { method, headers, credentials: 'same-origin' };
    if (body !== undefined) init.body = body;
    let response: Response;
    try {
      response = await fetchImpl(url, init);
    } catch (err) {
      throw new NetworkError(err);
    }
    if (!response.ok) throw await toApiError(response);
    if (response.status === 204) return undefined as T;
    try {
      return (await response.json()) as T;
    } catch (err) {
      throw new NetworkError(err);
    }
  }

  return {
    /** 200 SessionInfo, or throws ApiError 401 when there is no valid session (W0-02 7.2). */
    getSession: () => request<SessionInfo>('GET', API_PATHS.session),
    setSessionLocale: (body: SessionLocaleRequest) =>
      request<undefined>('POST', API_PATHS.sessionLocale, { body }),
    /** The fixture picker list: `null` when the route answers 404 (every mode but `fixture`; W0-02 7.2). */
    getFixtureUsers: async (): Promise<FixtureUsersResponse | null> => {
      try {
        return await request<FixtureUsersResponse>('GET', API_PATHS.fixtureUsers);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    fixtureSignIn: (body: FixtureSignInRequest) =>
      request<SessionInfo>('POST', API_PATHS.fixtureSignIn, { body }),
    /** `local-google`, `network`, `production`: returns the provider redirect the browser must follow. */
    startSignIn: (body: SignInRequest) => request<SignInResponse>('POST', API_PATHS.signIn, { body }),
    signOut: () => request<undefined>('POST', API_PATHS.signOut),
    getQueue: (query: QueueQuery = {}) =>
      request<QueueResponse>('GET', API_PATHS.queue, {
        query: {
          search: query.search,
          searchBy: query.searchBy,
          status: query.status,
          owner: query.owner,
          useCaseGroup: query.useCaseGroup,
          page: query.page,
          pageSize: query.pageSize,
        },
      }),
    listCases: (query: CaseListQuery = {}) =>
      request<CaseListResponse>('GET', API_PATHS.cases, {
        query: { page: query.page, pageSize: query.pageSize },
      }),
    getCase: (caseId: string) => request<CaseView>('GET', `${API_PATHS.cases}/${encodeURIComponent(caseId)}`),
    /** `Idempotency-Key` is a UUID minted per user action (W0-06 5.3); the caller mints it. */
    createCase: (body: CaseCreateRequest, idempotencyKey: string) =>
      request<CaseView>('POST', API_PATHS.cases, { body, idempotencyKey }),
    getConfiguration: () => request<ConfigurationView>('GET', API_PATHS.configuration),
    /** The open draft of a case (W0-02 7.5); 404 when the case has none. */
    getDraft: (caseId: string) => request<PackDraft>('GET', `${API_PATHS.cases}/${enc(caseId)}/draft`),
    /** One PUT with the draft's ExpectedVersion (W0-06 5.1); the answer replaces the draft. */
    saveDraft: (caseId: string, body: PackDraftUpdateRequest) =>
      request<PackDraft>('PUT', `${API_PATHS.cases}/${enc(caseId)}/draft`, { body }),
    /** One part named `file`; nothing else is sent (W0-08 section 3). Idempotent by content hash: no key. */
    uploadArtifact: (caseId: string, file: File) => {
      const form = new FormData();
      form.append('file', file, file.name);
      return request<ArtifactRef>('POST', `${API_PATHS.cases}/${enc(caseId)}/artifacts`, { form });
    },
    getArtifactMeta: (artifactId: string) =>
      request<ArtifactRef>('GET', `${API_PATHS.artifacts}/${enc(artifactId)}/meta`),
    listVersions: (caseId: string) =>
      request<VersionListResponse>('GET', `${API_PATHS.cases}/${enc(caseId)}/versions`),
    getVersion: (caseId: string, versionId: string) =>
      request<SubmittedVersion>('GET', `${API_PATHS.cases}/${enc(caseId)}/versions/${enc(versionId)}`),
    /** `Idempotency-Key` is a UUID minted per user action (W0-06 5.3); a replay returns the original 201. */
    submitDraft: (caseId: string, body: SubmitRequest, idempotencyKey: string) =>
      request<SubmittedVersion>('POST', `${API_PATHS.cases}/${enc(caseId)}/draft/submit`, {
        body,
        idempotencyKey,
      }),
    /** Lane-QC run for the reviewer's lane before decision controls (W0-02 7.7; W2-07). */
    runLaneQc: (caseId: string, versionId: string, lane: Lane, body: LaneQcRunRequest) =>
      request<LaneQcRunResponse>(
        'POST',
        `${API_PATHS.cases}/${enc(caseId)}/versions/${enc(versionId)}/lanes/${enc(lane)}/qc-run`,
        { body },
      ),
    /** Own-lane approve; carries the qcRunId the reviewer saw (W0-06 4.4). */
    approveLane: (
      caseId: string,
      versionId: string,
      lane: Lane,
      body: ApproveLaneRequest,
      idempotencyKey: string,
    ) =>
      request<LaneDecisionResponse>(
        'POST',
        `${API_PATHS.cases}/${enc(caseId)}/versions/${enc(versionId)}/lanes/${enc(lane)}/approve`,
        { body, idempotencyKey },
      ),
    /** Own-lane send-back; feedback must name at least one artifact slot (A09). */
    sendBackLane: (
      caseId: string,
      versionId: string,
      lane: Lane,
      body: SendBackLaneRequest,
      idempotencyKey: string,
    ) =>
      request<LaneDecisionResponse>(
        'POST',
        `${API_PATHS.cases}/${enc(caseId)}/versions/${enc(versionId)}/lanes/${enc(lane)}/send-back`,
        { body, idempotencyKey },
      ),
    /** Append a disposition event on a finding (W0-06 4.7); Idempotency-Key per user action. */
    recordDisposition: (
      caseId: string,
      findingId: string,
      body: DispositionRequest,
      idempotencyKey: string,
    ) =>
      request<DispositionResponse>(
        'POST',
        `${API_PATHS.cases}/${enc(caseId)}/findings/${enc(findingId)}/dispositions`,
        { body, idempotencyKey },
      ),
    /** Stored findings for a version with latestDisposition (version.view; no qc_run write). */
    listVersionFindings: (caseId: string, versionId: string) =>
      request<VersionFindingsResponse>(
        'GET',
        `${API_PATHS.cases}/${enc(caseId)}/versions/${enc(versionId)}/findings`,
      ),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

export const api: ApiClient = createApiClient();
