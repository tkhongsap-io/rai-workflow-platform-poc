# Intent: `BLOB_TMP_MAX_AGE_HOURS` below 1 is refused (W3-F7, #169)

H11 (W3 hardening) made the cleanup thresholds fail closed on an empty value but kept the temp-file minimum at 0. At 0, `store:cleanup` would remove an in-flight upload's staging file. The hardening review left this as an open W0-04 question. Ta ruled on 2026-09-26 (register row "W3 deferred rulings", item 7): minimum 1 hour.
