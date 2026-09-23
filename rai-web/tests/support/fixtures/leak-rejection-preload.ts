// Test-only preload, loaded into a spawned server through NODE_OPTIONS=--import; never part of the deployable. On
// SIGUSR2 it leaks one unhandled rejection whose message carries the database URL (host and user), so the spawn
// test can prove the fatal path logs neither.
process.on('SIGUSR2', () => {
  void Promise.reject(new Error(`synthetic leak ${process.env.DATABASE_URL ?? ''}`));
});
