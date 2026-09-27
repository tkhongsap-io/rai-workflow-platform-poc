// W4-05c (W4b plan section 4.3): the W0-08 hostile set is fed to the extractor. Every row ends as a clean reply,
// never a throw (a throw kills the worker: `crash`), and every row the upload refuses ends as `ok: false`. The rows
// are also rebuilt over a package whose text would otherwise extract, so a refusal is the refusal, not an empty body.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostileSet } from '../../../artifacts/sniff.test-bytes.js';
import { FORMAT_EXTRACTORS, extractInWorker, type WorkerLimits, type WorkerReply } from './extract.js';
import { FIXED_WORKER_LIMITS } from '../limits.js';
import {
  buildTestZip,
  docxEntries,
  DOCX,
  para,
  XLSX,
  xlsxEntries,
  inlineCell,
  type TestZipEntry,
} from './ooxml.test-helper.js';

const LIMITS: WorkerLimits = { maxTextChars: 1_000_000, ...FIXED_WORKER_LIMITS };
const MEDIA_TYPES = [DOCX, XLSX, 'application/pdf', 'image/png', 'image/jpeg'];
const run = (mediaType: string, bytes: Buffer): WorkerReply =>
  extractInWorker({ mediaType, bytes, limits: LIMITS });

test('every W0-08 hostile row ends as a clean reply under every media type; refused rows are ok:false', () => {
  for (const row of hostileSet())
    for (const mediaType of MEDIA_TYPES) {
      let reply: WorkerReply | undefined;
      assert.doesNotThrow(() => {
        reply = run(mediaType, row.bytes);
      }, `${row.name} as ${mediaType}`);
      if (row.expected !== 'accepted')
        assert.equal(reply?.ok, false, `${row.name} as ${mediaType}: ${JSON.stringify(reply)}`);
    }
});

test('the hostile package rows are refused even when the document part has text', () => {
  const textDocx = (): TestZipEntry[] => docxEntries(para('RAI-DESK-SYNTHETIC-FIXTURE hostile'));
  const withEntry = (entry: TestZipEntry) => buildTestZip([...textDocx(), entry]);
  const control = buildTestZip(textDocx());
  assert.equal(run(DOCX, control).ok, true, 'the control extracts');
  const rows: Array<[string, Buffer, string]> = [
    ['macro package', withEntry({ name: 'word/vbaProject.bin', data: Buffer.alloc(16) }), 'unreadable'],
    [
      'nested archive',
      withEntry({ name: 'word/embeddings/payload.zip', data: Buffer.alloc(16) }),
      'unreadable',
    ],
    [
      'embedded executable',
      withEntry({ name: 'word/embeddings/tool.exe', data: Buffer.alloc(16) }),
      'unreadable',
    ],
    ['traversal entry', withEntry({ name: '../../etc/passwd', data: 'x' }), 'unreadable'],
    [
      'encrypted entry',
      buildTestZip(textDocx().map((e) => (e.name === 'word/document.xml' ? { ...e, flags: 1 } : e))),
      'unreadable',
    ],
    ['ZIP64', buildTestZip(textDocx(), { zip64Locator: true }), 'unreadable'],
    [
      'polyglot (trailing bytes)',
      buildTestZip(textDocx(), { trailing: Buffer.alloc(16, 0x41) }),
      'unreadable',
    ],
    [
      'declared bomb',
      withEntry({ name: 'word/big.bin', data: Buffer.alloc(8), declaredSize: 1024 * 1024 * 1024 }),
      'limit_bytes',
    ],
  ];
  for (const [name, bytes, reason] of rows) assert.deepEqual(run(DOCX, bytes), { ok: false, reason }, name);
  const textXlsx = xlsxEntries([{ name: 'S', cells: `<row r="1">${inlineCell('A1', 'x')}</row>` }]);
  assert.equal(run(XLSX, buildTestZip(textXlsx)).ok, true, 'the XLSX control extracts');
  assert.deepEqual(run(XLSX, buildTestZip([...textXlsx, { name: 'xl/vbaProject.bin', data: 'x' }])), {
    ok: false,
    reason: 'unreadable',
  });
});

test('a DOCX declared as XLSX, or the reverse, is unreadable', () => {
  const docx = buildTestZip(docxEntries(para('text')));
  const xlsx = buildTestZip(xlsxEntries([{ name: 'S', cells: `<row r="1">${inlineCell('A1', 'x')}</row>` }]));
  assert.deepEqual(run(XLSX, docx), { ok: false, reason: 'unreadable' });
  assert.deepEqual(run(DOCX, xlsx), { ok: false, reason: 'unreadable' });
});

test('the registry holds DOCX and XLSX only; PDF and images stay unreadable until W4-05d', () => {
  assert.deepEqual([...FORMAT_EXTRACTORS.keys()].sort(), [DOCX, XLSX].sort());
});
