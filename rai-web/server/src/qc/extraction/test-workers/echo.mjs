// Describes its own process in the one segment it returns, so a test can check what the host gave it.
process.once('message', (request) => {
  const text = JSON.stringify({
    pid: process.pid,
    envKeys: Object.keys(process.env),
    execArgv: process.execArgv,
    stdout: process.stdout.isTTY === true,
    bytesIsUint8Array: request.bytes instanceof Uint8Array,
    byteLength: request.bytes.byteLength,
    mediaType: request.mediaType,
    limits: request.limits,
  });
  process.send({ ok: true, segments: [{ locator: { kind: 'absent' }, text }] });
});
