// `npm run store:verify` (W0-02 section 3.3): re-hashes every blob an artifact row references; non-zero exit on
// any mismatch. Needs the W1-03a BlobStore (server/src/artifacts/); until it lands this command says so and fails.
console.error(
  'store:verify: the blob store arrives with ticket W1-03a (W0-04 "Artifact store"); nothing verified',
);
process.exit(1);
