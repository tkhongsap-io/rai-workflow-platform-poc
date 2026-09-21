// `npm run fixtures:generate` (W0-02 section 3.3): writes the W0-08 synthetic documents from data/manifest.json into
// the gitignored output directory. The generator, the manifest and the cases arrive with W1-09; until then this
// command says so and exits non-zero rather than pretending.
console.error(
  'fixtures:generate: the document generator arrives with ticket W1-09 (W0-08 section 8.5); nothing generated',
);
process.exit(1);
