# W3-03b additive digest locale prerequisite

Parent requested a separate shared contract before consumer PR. Add only mail.sla_breach_digest (subject) and mail.sla_breach_digest.body to both en/th catalogues. Thai remains default. Body placeholders: day (persisted Bangkok job-start day, Gregorian YYYY-MM-DD), count (distinct overdue cases), entries (server-rendered case IDs, localized lanes, frozen due dates and safe case links). Each link requires sign-in and existing authorization; the message grants no access.

No other locale text, shared type, schema, migration or runtime changes. The producer supplies validated content, never document or finding evidence. Consumer and single W3-04 dispatcher follow after this prerequisite; no external delivery. Parent opens/reviews/merges the prerequisite PR. This local commit is not publication authorization.

Validation: JSON parses; both new keys exist in both catalogues with identical placeholder sets; diff contains only the two keys per locale. The existing six scheduler/locale tests and typecheck passed with these exact key values on consumer 1bad092; no new runtime behavior in this extraction.
