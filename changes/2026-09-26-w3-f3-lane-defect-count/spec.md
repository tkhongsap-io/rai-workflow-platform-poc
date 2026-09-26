# Specification

Done when:

1. The lane-opened mail's `defectCount` counts `defect` findings owned by the mail's lane on the version.
2. "At send time" means when the notification worker composes the attempt that is delivered: the body is recomposed on every attempt (W0-07 section 4), no notification column is written, and the dedup/retry contract is unchanged. At outbox-insert time a fresh version has no findings, so that reading would always give 0.
3. The ticket's two stated choices: a **dispositioned** defect still counts (the count is "recorded", not "open"; on a freshly opened lane nothing is dispositioned yet); a **QC-unavailable** finding does not count (a failed check, not a defect; it is its own finding, W0-07 3.6, and the "so far" label avoids reading 0 as a clean pass).
4. The label reads "Defects recorded so far" / "ข้อบกพร่องที่บันทึกไว้จนถึงขณะนี้".
5. W0-06 4.11 and W0-07 section 4 say this. A test with defects on two lanes and an unavailable finding shows per-lane counts (2, 1, 0) and the label. Full suite green; two reviewers; CI.
