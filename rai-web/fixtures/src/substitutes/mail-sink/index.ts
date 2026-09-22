// W1-11: the W0-07 mail-sink substitutes. Lane C; dev and test only; never in the production build.
// `MAIL_MODE=sink-memory` selects MemoryMailSink, `MAIL_MODE=sink-file` selects FileMailSink (the notifications
// module, W3-03, does the selection from the typed config). No other value exists (W0-07 section 4.6).

export type { MailSinkControl, ForcedFailureReason } from './control.js';
export { MAIL_SINK_SUBSTITUTE_MARKER, type MailSinkOptions } from './base.js';
export { MemoryMailSink } from './memory.js';
export { FileMailSink, mailFileStem, type FileMailSinkOptions, type MailSinkFile } from './file.js';
export {
  CANONICAL_ROUTE_PATTERNS,
  MAX_BODY_BYTES,
  MAX_SUBJECT_BYTES,
  isSyntheticAddress,
  validateDeliveryRequest,
  type DeliveryError,
} from './validate.js';
