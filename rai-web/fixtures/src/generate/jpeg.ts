// Fixed 16 x 16 baseline JPEG (W0-08 8.5): SOI, a COM segment carrying the sentinel, the fixture id and the Thai
// line, DQT, SOF0 (one grey component), two one-symbol Huffman tables, SOS, one byte of scan data (four 8 x 8
// blocks, each a zero DC difference and an EOB), EOI. Only the COM payload varies per fixture. UTF-8 never contains
// 0xFF, so the comment cannot forge a marker.

function segment(marker: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header[0] = 0xff;
  header[1] = marker;
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

const DQT = segment(0xdb, Buffer.concat([Buffer.from([0x00]), Buffer.alloc(64, 1)]));
const SOF0 = segment(
  0xc0,
  Buffer.from([
    8, // precision
    0x00,
    0x10, // height 16
    0x00,
    0x10, // width 16
    1, // one component
    1, // component id
    0x11, // sampling 1x1
    0, // quantisation table 0
  ]),
);
function oneSymbolHuffmanTable(classAndId: number, symbol: number): Buffer {
  const counts = Buffer.alloc(16, 0);
  counts[0] = 1; // one code of length 1
  return segment(0xc4, Buffer.concat([Buffer.from([classAndId]), counts, Buffer.from([symbol])]));
}
const DHT_DC = oneSymbolHuffmanTable(0x00, 0x00); // DC table 0: category 0 (difference zero)
const DHT_AC = oneSymbolHuffmanTable(0x10, 0x00); // AC table 0: EOB
const SOS = segment(0xda, Buffer.from([1, 1, 0x00, 0, 63, 0]));
const SCAN = Buffer.from([0x00]); // four blocks x (DC '0' + EOB '0') = 8 bits

export function buildJpeg(comment: string): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xfe, Buffer.from(comment, 'utf8')),
    DQT,
    SOF0,
    DHT_DC,
    DHT_AC,
    SOS,
    SCAN,
    Buffer.from([0xff, 0xd9]),
  ]);
}
