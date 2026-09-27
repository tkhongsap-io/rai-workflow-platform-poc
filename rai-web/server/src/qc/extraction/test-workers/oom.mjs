// Exhausts its capped heap: V8 aborts the process (SIGABRT), which the host reads as `limit_memory`.
process.once('message', () => {
  const hoard = [];
  for (;;) hoard.push(new Array(100_000).fill({ n: hoard.length }));
});
