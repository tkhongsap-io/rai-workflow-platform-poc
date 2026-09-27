// W4-05c (W4b plan sections 4.3 and 4.4): the worker's ZIP reader. Central directory as in sniff.ts; parts read on
// demand with inflateRawSync under maxOutputLength; every inconsistency is `unreadable`, every cap `limit_bytes`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { ExtractionStop } from './sink.js';
import { openZip, type ZipLimits } from './zip.js';
import { buildTestZip, type TestZipEntry } from './ooxml.test-helper.js';

const LIMITS: ZipLimits = { maxPartBytes: 1024 * 1024, maxTotalBytes: 4 * 1024 * 1024 };
const A: TestZipEntry = { name: 'a.xml', data: '<a>stored</a>' };
const B: TestZipEntry = { name: 'dir/b.xml', data: '<b>deflated</b>'.repeat(20), method: 8 };

function stops(reason: string, run: () => unknown, message?: string) {
  assert.throws(run, (e) => e instanceof ExtractionStop && e.reason === reason, message);
}

test('stored and deflate parts read back; an absent part is undefined', () => {
  const zip = openZip(buildTestZip([A, B]), LIMITS);
  assert.deepEqual([...zip.names], ['a.xml', 'dir/b.xml']);
  assert.equal(zip.read('a.xml')?.toString('utf8'), '<a>stored</a>');
  assert.equal(zip.read('dir/b.xml')?.toString('utf8'), '<b>deflated</b>'.repeat(20));
  assert.equal(zip.read('missing.xml'), undefined);
  assert.equal(zip.has('a.xml'), true);
  assert.equal(zip.has('missing.xml'), false);
});

test('a container that is not a consistent ZIP is unreadable', () => {
  const good = buildTestZip([A, B]);
  const cases: Array<[string, Buffer]> = [
    ['empty', Buffer.alloc(0)],
    ['not a zip', Buffer.from('%PDF-1.4 nothing here at all, not a zip archive')],
    ['trailing bytes', buildTestZip([A], { trailing: Buffer.alloc(8, 0x41) })],
    ['ZIP64 locator', buildTestZip([A], { zip64Locator: true })],
    ['entry count mismatch', buildTestZip([A, B], { countOverride: 1 })],
    ['directory offset off', buildTestZip([A, B], { centralOffsetDelta: -4 })],
    ['truncated', good.subarray(0, good.length - 30)],
    ['duplicate name', buildTestZip([A, { ...A, data: '<a>other</a>' }])],
    ['traversal name', buildTestZip([A, { name: '../escape.xml', data: 'x' }])],
    ['absolute name', buildTestZip([A, { name: '/root.xml', data: 'x' }])],
    ['backslash name', buildTestZip([A, { name: 'dir\\x.xml', data: 'x' }])],
    ['NUL name', buildTestZip([A, { name: 'a\u0000.xml', data: 'x' }])],
    ['encrypted entry', buildTestZip([{ ...A, flags: 1 }])],
    ['other method', buildTestZip([{ ...A, method: 12 }])],
    ['macro package', buildTestZip([A, { name: 'word/vbaProject.bin', data: 'x' }])],
    ['nested archive', buildTestZip([A, { name: 'word/embeddings/payload.zip', data: 'x' }])],
    ['embedded executable', buildTestZip([A, { name: 'word/embeddings/tool.exe', data: 'x' }])],
    ['overlapping entries', buildTestZip([A, { ...A, name: 'b.xml' }], { overlapSecondOntoFirst: true })],
  ];
  for (const [name, bytes] of cases)
    stops(
      'unreadable',
      () => {
        const zip = openZip(bytes, LIMITS);
        for (const n of zip.names) zip.read(n);
      },
      name,
    );
});

test('a part whose bytes disagree with its directory entry is unreadable', () => {
  const cases: Array<[string, TestZipEntry]> = [
    ['CRC mismatch', { ...A, crc: 0x12345678 }],
    ['stored size mismatch', { ...A, declaredSize: 5 }],
    ['deflate size mismatch', { ...B, declaredSize: 7 }],
    ['local name differs', { ...A, localName: 'z.xml' }],
    ['broken deflate stream', { ...A, method: 8, compressedOverride: Buffer.from([0xff, 0xff, 0xff, 0xff]) }],
  ];
  for (const [name, entry] of cases)
    stops('unreadable', () => openZip(buildTestZip([entry]), LIMITS).read(entry.name), name);
});

test('a declared part or total over the caps is limit_bytes before any inflate', () => {
  stops('limit_bytes', () =>
    openZip(buildTestZip([{ ...A, declaredSize: LIMITS.maxPartBytes + 1 }]), LIMITS),
  );
  const quarter = LIMITS.maxTotalBytes / 4;
  const many = [0, 1, 2, 3, 4].map((i) => ({
    name: `p${i}.xml`,
    data: 'x',
    method: 8,
    declaredSize: quarter,
  }));
  stops('limit_bytes', () => openZip(buildTestZip(many), { ...LIMITS, maxPartBytes: quarter }));
});

test('a decompression bomb that lies about its size is limit_bytes, never a large buffer', () => {
  const bomb = Buffer.alloc(LIMITS.maxPartBytes * 4, 0x41);
  const entry: TestZipEntry = {
    name: 'word/document.xml',
    data: 'x',
    method: 8,
    declaredSize: 100,
    compressedOverride: deflateRawSync(bomb),
    crc: 0,
  };
  const zip = openZip(buildTestZip([entry]), LIMITS);
  stops('limit_bytes', () => zip.read('word/document.xml'));
});

test('bytes actually inflated count toward the total cap, so re-reading a part cannot exceed it', () => {
  const entries = [{ name: 'p0.xml', data: 'y'.repeat(600), method: 8 }];
  const zip = openZip(buildTestZip(entries), { maxPartBytes: 1000, maxTotalBytes: 1500 });
  zip.read('p0.xml');
  zip.read('p0.xml');
  stops('limit_bytes', () => zip.read('p0.xml'));
});

test('an entry count over 2 000 is unreadable', () => {
  const entries = Array.from({ length: 2001 }, (_, i) => ({ name: `p${i}`, data: '' }));
  stops('unreadable', () => openZip(buildTestZip(entries), LIMITS));
});
