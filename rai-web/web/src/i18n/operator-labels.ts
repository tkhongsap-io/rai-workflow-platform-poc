// W3-07b prerequisite: exhaustive labels for the committed W3-07a report enums.
// These maps describe values, never compute readiness, access, scheduling or workflow state.
import type { LocaleKey } from '@rai/shared/locales/keys';
import type { DeskHealthReport, ReadinessReport } from '@rai/shared/schemas/observability';

type Mail = DeskHealthReport['failedMail'][number];
type Qc = DeskHealthReport['unavailableQc'][number];
type DigestRun = NonNullable<DeskHealthReport['slaDigest']['lastRun']>;
type DigestFailure = DeskHealthReport['slaDigest']['recentFailures'][number];
export type OperatorValue =
  | ReadinessReport['status']
  | ReadinessReport['identity']['mode']
  | ReadinessReport['identity']['status']
  | ReadinessReport['store']['db']
  | ReadinessReport['store']['migrations']
  | ReadinessReport['store']['blob']
  | ReadinessReport['mailSink']['kind']
  | ReadinessReport['mailSink']['status']
  | ReadinessReport['qc']['kind']
  | ReadinessReport['qc']['status']
  | Mail['eventType']
  | Mail['status']
  | Mail['lastErrorCode']
  | Qc['trigger']
  | Qc['reason']
  | DeskHealthReport['lateQc'][number]['status']
  | DigestRun['status']
  | DigestFailure['stage']
  | DigestFailure['errorCode']
  | DeskHealthReport['errorCounters'][number]['code'];

export const OPERATOR_VALUE_KEYS = {
  ready: 'operator.value.ready',
  not_ready: 'operator.value.not_ready',
  ok: 'operator.value.ok',
  misconfigured: 'operator.value.misconfigured',
  unreachable: 'operator.value.unreachable',
  timeout: 'operator.value.timeout',
  current: 'operator.value.current',
  pending: 'operator.value.pending',
  unknown: 'operator.value.unknown',
  not_writable: 'operator.value.not_writable',
  unavailable: 'operator.value.unavailable',
  disabled: 'operator.value.disabled',
  fixture: 'operator.value.fixture',
  'local-google': 'operator.value.local_google',
  network: 'operator.value.network',
  production: 'operator.value.production',
  unset: 'operator.value.unset',
  memory: 'operator.value.memory',
  file: 'operator.value.file',
  smtp: 'operator.value.smtp',
  substitute: 'operator.value.substitute',
  deterministic: 'operator.value.deterministic',
  model: 'operator.value.model',
  lane_open: 'operator.value.lane_open',
  send_back: 'operator.value.send_back',
  sla_breach_digest: 'operator.value.sla_breach_digest',
  queued: 'operator.value.queued',
  failed: 'operator.value.failed',
  malformed_request: 'operator.value.malformed_request',
  sink_failure: 'operator.value.sink_failure',
  rejected_recipient: 'operator.value.rejected_recipient',
  unsafe_link: 'operator.value.unsafe_link',
  duplicate: 'operator.value.duplicate',
  upload: 'operator.value.upload',
  submit: 'operator.value.submit',
  approve_attempt: 'operator.value.approve_attempt',
  runner_error: 'operator.value.runner_error',
  not_configured: 'operator.value.not_configured',
  artifact_unreadable: 'operator.value.artifact_unreadable',
  completed: 'operator.value.completed',
  running: 'operator.value.running',
  query: 'operator.value.query',
  render: 'operator.value.render',
  enqueue: 'operator.value.enqueue',
  query_failed: 'operator.value.query_failed',
  render_failed: 'operator.value.render_failed',
  enqueue_failed: 'operator.value.enqueue_failed',
  unauthenticated: 'operator.value.unauthenticated',
  forbidden: 'operator.value.forbidden',
  stale_version: 'operator.value.stale_version',
  invalid_input: 'operator.value.invalid_input',
  unsafe_upload: 'operator.value.unsafe_upload',
  qc_unavailable: 'operator.value.qc_unavailable',
  mail_delivery_failed: 'operator.value.mail_delivery_failed',
  not_found: 'operator.value.not_found',
  internal_error: 'operator.value.internal_error',
} as const satisfies Record<OperatorValue, LocaleKey>;

export const OPERATOR_IDENTITY_REASON_KEYS = {
  mode_unknown: 'operator.identity_reason.mode_unknown',
  bind_not_loopback: 'operator.identity_reason.bind_not_loopback',
  base_url_not_loopback: 'operator.identity_reason.base_url_not_loopback',
  base_url_not_https: 'operator.identity_reason.base_url_not_https',
  proxy_forbidden_in_mode: 'operator.identity_reason.proxy_forbidden_in_mode',
  network_source_unknown: 'operator.identity_reason.network_source_unknown',
  allow_list_invalid: 'operator.identity_reason.allow_list_invalid',
  google_forbidden_in_mode: 'operator.identity_reason.google_forbidden_in_mode',
  issuer_not_entra: 'operator.identity_reason.issuer_not_entra',
  group_mapping_missing: 'operator.identity_reason.group_mapping_missing',
  fixture_outside_test: 'operator.identity_reason.fixture_outside_test',
  discovery_failed: 'operator.identity_reason.discovery_failed',
  'secret_missing:RAI_IDENTITY_GOOGLE_CLIENT_ID':
    'operator.identity_reason.secret_missing_rai_identity_google_client_id',
  'secret_missing:RAI_IDENTITY_GOOGLE_CLIENT_SECRET':
    'operator.identity_reason.secret_missing_rai_identity_google_client_secret',
  'secret_missing:RAI_IDENTITY_OIDC_ISSUER_URL':
    'operator.identity_reason.secret_missing_rai_identity_oidc_issuer_url',
  'secret_missing:RAI_IDENTITY_OIDC_CLIENT_ID':
    'operator.identity_reason.secret_missing_rai_identity_oidc_client_id',
  'secret_missing:RAI_IDENTITY_OIDC_CLIENT_SECRET':
    'operator.identity_reason.secret_missing_rai_identity_oidc_client_secret',
  'secret_missing:RAI_IDENTITY_ALLOW_LIST_JSON':
    'operator.identity_reason.secret_missing_rai_identity_allow_list_json',
  'secret_missing:RAI_IDENTITY_ENTRA_TENANT_ID':
    'operator.identity_reason.secret_missing_rai_identity_entra_tenant_id',
  'secret_missing:RAI_SESSION_ABSOLUTE_HOURS':
    'operator.identity_reason.secret_missing_rai_session_absolute_hours',
} as const satisfies Record<NonNullable<ReadinessReport['identity']['reason']>, LocaleKey>;

export const OPERATOR_LANE_KEYS = {
  ai_coe: 'lane.ai_coe',
  dpo: 'lane.dpo',
  it_security: 'lane.it_security',
} as const satisfies Record<NonNullable<Qc['owningLane']>, LocaleKey>;

// The stored mail event is `ready`, whose label describes desk completion rather than service readiness.
export const OPERATOR_MAIL_EVENT_KEYS = {
  lane_open: 'operator.value.lane_open',
  send_back: 'operator.value.send_back',
  ready: 'operator.value.ready_for_launch',
  sla_breach_digest: 'operator.value.sla_breach_digest',
} as const satisfies Record<Mail['eventType'], LocaleKey>;
