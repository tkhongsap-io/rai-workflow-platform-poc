# Specification

Done when:

1. The send-back mail's one deep link is the case page, `/cases/{caseId}`, route `case`: the page that shows the owner's open successor draft and its feedback. Lane-opened and Ready links are unchanged (`case_version`).
2. The committed outbox row stores that path (`deep_link_path`), and the worker still refuses a mail whose composed link differs from it (the existing agreement check). The mail sink's link rules already allow route `case` for this kind.
3. The link names no draft id: the SPA has no draft-specific URL. This differs from the W3-F4 row's wording ("names the draft") and #166 ("built from the committed successor draft id"); the row gets a dated note and #166 a correction.
4. W0-07 section 4 says `sent_back` uses route `case`. Tests: the compose unit test (send-back routes to `case`, the others to `case_version`, `caseLink` param equals the link) failed first; the w3-03a send-back integration test pins the delivered link, the stored path and a signed-out 401. Full suite green; two reviewers; CI.
