# Specification

Done when:

1. `parseRetentionConfig` reads `BLOB_TMP_MAX_AGE_HOURS` with minimum 1. The server's `parseConfig` and `store:cleanup` both use it, so 0 fails with `invalid:BLOB_TMP_MAX_AGE_HOURS`: at start-up this is a configuration refusal, and `store:cleanup` exits 1 before the blob store is opened.
2. At 1, a staging file younger than one hour survives `store:cleanup`.
3. W0-02 section 5 says "Integer ≥ 1". W0-04's failed-uploads paragraph states the floor and the ruling, which closes the question. `.env.example` is already 1 and is unchanged.
4. Tests: `config.test.ts` (start-up refusal at 0, accepted at 1) and `operator/cleanup.test.ts` (refusal at 0 leaves the file; the run at 1 keeps it). Both failed first. Full suite green.
