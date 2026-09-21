// `npm run store:cleanup` (W0-02 section 3.3): removes stale temp files under BLOB_DIR/tmp; orphan-blob removal only
// after D08. Needs the W1-03a BlobStore; until it lands this command says so and fails.
console.error(
  'store:cleanup: the blob store arrives with ticket W1-03a (W0-04 "Artifact store"); nothing cleaned',
);
process.exit(1);
