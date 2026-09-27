// Replies with something that is not a protocol reply (`crash`).
process.once('message', () => process.send({ ok: true, segments: 'not an array' }));
