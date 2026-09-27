// W4-05b (W4b plan section 4.2): the extraction worker's entry. The host forks it once per artifact with an empty
// environment, no stdio and a capped heap, sends exactly one request over IPC and SIGKILLs it once the reply is read.
// It answers exactly one message; a malformed request or a parser bug throws, the process exits non-zero, and the
// host records `crash`. Nothing is printed (stdio is ignored anyway) and nothing is written.
import { extractInWorker, isWorkerRequest } from './extract.js';

process.once('message', (message: unknown) => {
  if (!isWorkerRequest(message)) throw new TypeError('not an extraction request');
  process.send?.(extractInWorker(message));
});
// The host going away ends the worker: it has no other purpose.
process.once('disconnect', () => process.exit(0));
