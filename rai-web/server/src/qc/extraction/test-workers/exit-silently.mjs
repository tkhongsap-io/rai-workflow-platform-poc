// Exits cleanly without a reply (`crash`: no answer is never a clean result).
process.once('message', () => process.exit(0));
