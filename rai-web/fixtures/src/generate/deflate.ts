// A fixed-Huffman DEFLATE encoder (RFC 1951 3.2.6), literals only, one final block, for the evaluation set's
// FlateDecode PDF streams and deflate ZIP entries (W4-09a). node:zlib's deflate output depends on the zlib build
// and CPU path (the fixture manifests pin SHA-256 digests on every platform), so the set writes its own: a valid
// compressed stream that exercises the extractor's Huffman decoding, and the same bytes everywhere.

class BitWriter {
  private readonly bytes: number[] = [];
  private current = 0;
  private count = 0;

  /** Appends `length` bits of `value`, least significant bit first (RFC 1951 3.1.1). */
  writeBits(value: number, length: number): void {
    for (let i = 0; i < length; i += 1) {
      this.current |= ((value >>> i) & 1) << this.count;
      this.count += 1;
      if (this.count === 8) {
        this.bytes.push(this.current);
        this.current = 0;
        this.count = 0;
      }
    }
  }

  /** Appends a Huffman code, most significant bit first. */
  writeCode(code: number, length: number): void {
    for (let i = length - 1; i >= 0; i -= 1) this.writeBits((code >>> i) & 1, 1);
  }

  finish(): Buffer {
    if (this.count > 0) this.bytes.push(this.current);
    return Buffer.from(this.bytes);
  }
}

/** Raw DEFLATE: BFINAL=1, BTYPE=01, every byte as a fixed-code literal, then end-of-block (256). */
export function deflateRawFixed(data: Uint8Array): Buffer {
  const w = new BitWriter();
  w.writeBits(1, 1); // BFINAL
  w.writeBits(1, 2); // BTYPE 01: fixed Huffman codes
  for (const byte of data) {
    if (byte <= 143) w.writeCode(0x30 + byte, 8);
    else w.writeCode(0x190 + (byte - 144), 9);
  }
  w.writeCode(0, 7); // 256: end of block
  return w.finish();
}

export function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** A zlib stream (RFC 1950): CMF 0x78, FLG 0x01 (no dictionary, check bits valid), fixed DEFLATE, Adler-32. */
export function zlibFixed(data: Uint8Array): Buffer {
  const trailer = Buffer.alloc(4);
  trailer.writeUInt32BE(adler32(data));
  return Buffer.concat([Buffer.from([0x78, 0x01]), deflateRawFixed(data), trailer]);
}
