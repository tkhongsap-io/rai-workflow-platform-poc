// Never replies: the host's wall clock (or the caller's abort) must kill it (`limit_time`). The listener stays attached
// so the IPC channel keeps the process alive.
process.on('message', () => {});
