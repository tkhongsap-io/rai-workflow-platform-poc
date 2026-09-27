# Plan

1. Board CLAIM (Lane A). Change frame (this folder).
2. Experiments before code (scratch, not committed): fork latency of a trivial worker under `tsx` and plain Node; `--permission` under both; the exit status of a V8 heap death (SIGABRT).
3. RED (tests first, run and watched failing), all under `server/src/qc/extraction/`:
   - `limits.test.ts`: bounds refused and accepted; fixed limits.
   - `protocol.test.ts`: reply classification (well-formed ok, each worker reason, extra keys, bad locator, bad reason, non-object, over the char cap, over the segment cap).
   - `worker/extract.test.ts`: empty registry is `unreadable`; sink caps; typed stops; other throws propagate; no segment is `unreadable`.
   - `worker/module-graph.test.ts`: item 6 of the spec.
   - `client.test.ts`: the real worker entry answers `unreadable`; fault workers (`test-workers/*.mjs`: hang, heap, crash, exit without reply, malformed reply, over-cap reply, env and argv echo, pid echo, permission probe) give `limit_time`, `limit_memory`, `crash`, `limit_output`; abort before and during; `limit_bytes` without fork; one PID per call; empty env; heap flag passed; concurrency cap and FIFO; queued abort; selfTest; entry and loader-flag selection; version.
   - `latency.test.ts`: two extractions at concurrency 2 under the source layout and under a precompiled worker (TypeScript's `transpileModule` of `worker/` into a temporary directory).
4. GREEN: `port.ts`, `limits.ts`, `protocol.ts`, `client.ts`, `worker/extract.ts`, `worker/main.ts`.
5. Full gate, one suite at a time, logs under `/tmp/rai-w4-05b-extraction-worker-host-protocol-logs/`; latency against the real build output.
6. review.md, DEVLOG, CHANGELOG; commit, push, verify the remote head, open the PR ("Refs #212").
