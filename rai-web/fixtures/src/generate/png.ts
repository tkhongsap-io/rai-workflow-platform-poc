// 64 x 64 RGB PNG (W0-08 8.5): IHDR, a tEXt chunk `Comment=RAI-DESK-SYNTHETIC-FIXTURE\n<id>...` (the ASCII lines), an iTXt chunk with the
// Thai line (iTXt is UTF-8; tEXt is Latin-1), one IDAT holding a level-0 (stored) zlib stream, IEND. CRCs from
// node:zlib. Deterministic pixels: a gradient, the same on every run.

import { crc32, deflateSync } from 'node:zlib';

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])) >>> 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

export function buildPng(input: { comment: string; thaiLine: string; size?: number }): Buffer {
  const size = input.size ?? 64;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (1 + size * 3);
    raw[rowStart] = 0; // filter type none
    for (let x = 0; x < size; x += 1) {
      const p = rowStart + 1 + x * 3;
      raw[p] = (x * 4) & 0xff;
      raw[p + 1] = (y * 4) & 0xff;
      raw[p + 2] = ((x ^ y) * 4) & 0xff;
    }
  }
  const idat = deflateSync(raw, { level: 0 }); // stored blocks: no compression, deterministic

  // tEXt: keyword, NUL, Latin-1 text (newlines allowed). The comment is ASCII by construction.
  const text = Buffer.concat([
    Buffer.from('Comment', 'latin1'),
    Buffer.from([0]),
    Buffer.from(input.comment, 'latin1'),
  ]);
  // iTXt: keyword, NUL, compression flag 0, method 0, language tag "th", NUL, translated keyword, NUL, UTF-8 text.
  const itxt = Buffer.concat([
    Buffer.from('Description', 'latin1'),
    Buffer.from([0, 0, 0]),
    Buffer.from('th', 'latin1'),
    Buffer.from([0]),
    Buffer.from([0]),
    Buffer.from(input.thaiLine, 'utf8'),
  ]);

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('tEXt', text),
    chunk('iTXt', itxt),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
