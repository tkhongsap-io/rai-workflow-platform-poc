// A well-formed reply plus a key the protocol does not have (`crash`: the reply schema refuses unknown keys).
process.once('message', () =>
  process.send({ ok: false, reason: 'unreadable', extractorVersion: 'forged/9' }),
);
