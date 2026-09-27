// Ignores the text cap it was sent and returns one character more (`limit_output`, enforced again by the host).
process.once('message', (request) => {
  const text = 'x'.repeat(request.limits.maxTextChars + 1);
  process.send({ ok: true, segments: [{ locator: { kind: 'absent' }, text }] });
});
