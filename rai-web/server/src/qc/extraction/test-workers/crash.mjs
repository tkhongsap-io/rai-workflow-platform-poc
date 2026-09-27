// Throws on the request: an uncaught error exits with code 1 (`crash`).
process.once('message', () => {
  throw new Error('synthetic parser bug');
});
