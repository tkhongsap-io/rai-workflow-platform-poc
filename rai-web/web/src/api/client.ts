// W1-07 (Lane B): the typed client over @rai/shared (W0-02 section 1: "the only place fetch is called"). It speaks
// the section 7 shapes to whatever answers /api and /auth on the same origin: the real server (W1-INT) or, behind
// the Vite proxy, the W1-13 substitute. It never decides access: every 401/403 arrives here as an ApiError carrying
// the W0-06 8.2 envelope and the screens render what they were told (section 1.1 "the SPA never decides access").

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
import type {
  CaseCreateRequest,
  CaseListQuery,
  CaseListResponse,
  CaseView,
  ConfigurationView,
} from '@rai/shared/schemas/cases';

export const API_PATHS = Object.freeze({
  session: '/api/session',
  sessionLocale: '/api/session/locale',
  signIn: '/auth/sign-in',
  signOut: '/auth/sign-out',
  fixtureUsers: '/auth/fixture/users',
  fixtureSignIn: '/auth/fixture/sign-in',
  cases: '/api/cases',
  configuration: '/api/configuration/current',
});

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
    let body: string | undefined;
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.body);
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
    listCases: (query: CaseListQuery = {}) =>
      request<CaseListResponse>('GET', API_PATHS.cases, {
        query: { page: query.page, pageSize: query.pageSize },
      }),
    getCase: (caseId: string) => request<CaseView>('GET', `${API_PATHS.cases}/${encodeURIComponent(caseId)}`),
    /** `Idempotency-Key` is a UUID minted per user action (W0-06 5.3); the caller mints it. */
    createCase: (body: CaseCreateRequest, idempotencyKey: string) =>
      request<CaseView>('POST', API_PATHS.cases, { body, idempotencyKey }),
    getConfiguration: () => request<ConfigurationView>('GET', API_PATHS.configuration),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

export const api: ApiClient = createApiClient();
