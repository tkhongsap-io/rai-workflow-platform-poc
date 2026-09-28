// W0-07 section 4.3 delivery validation. Since W7-07 (W7 plan section 5.3) the checks live in @rai/shared so the
// server's in-product file drop and these substitutes share one contract; the exported names are unchanged.

export {
  CANONICAL_ROUTE_PATTERNS,
  MAX_BODY_BYTES,
  MAX_SUBJECT_BYTES,
  isSyntheticAddress,
  validateDeliveryRequest,
  type DeliveryError,
} from '@rai/shared/mail/validate';
