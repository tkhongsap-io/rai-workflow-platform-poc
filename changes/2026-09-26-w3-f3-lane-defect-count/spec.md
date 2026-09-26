# Specification

Done when:

1. The lane-opened mail's count (parameter renamed `findingCount`) counts the findings owned by the mail's lane on the version: defects and QC-unavailable findings alike, as the ruling says "findings".
2. "At send time" means when the notification worker composes the attempt that is delivered: the body is recomposed on every attempt (W0-07 section 4), no notification column is written, and the dedup/retry contract is unchanged. At outbox-insert time a fresh version has no findings, so that reading would always give 0.
3. The ticket's two stated choices: a **dispositioned** finding still counts (the count is "recorded", not "open"; on a freshly opened lane nothing is dispositioned yet); a **QC-unavailable** finding counts too (it is a finding of the lane, W0-07 3.6, so an outage never reads as 0; W0-07 1: an unavailable run "is never a clean pass"). Review round 1 changed this from an exclusion that followed neither the ruling's wording nor W0-07.
4. The label reads "Findings recorded so far" / "ข้อค้นพบที่บันทึกไว้จนถึงขณะนี้".
5. W0-06 4.11 and W0-07 section 4 say this. A test with defects on two lanes and an unavailable finding on a third shows per-lane counts (2, 1, 1) and the label in each recipient's language. Full suite green; two reviewers; CI.
