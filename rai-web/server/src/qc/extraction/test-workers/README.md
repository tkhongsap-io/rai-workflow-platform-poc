# Fault workers (tests only)

Plain ES modules that stand in for `worker/main.ts` in `client.test.ts`, so each host limit can be driven without a test hook in the product worker. Each reads the one request message and misbehaves in one way. They are never built, bundled or imported by product code; `createWorkerExtractor` reaches them only through the `entry` option a test passes.
