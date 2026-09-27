// W4-05c (W4b plan section 4.3): XLSX yields one `cell` segment per non-blank cell, located by its 1-based sheet
// ordinal (workbook order) and its A1 reference. No sheet name reaches a locator (decision 21).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractInWorker, type WorkerLimits, type WorkerReply } from './extract.js';
import { extractXlsx } from './xlsx.js';
import { buildTestZip, inlineCell, S_NS, XLSX, xlsxEntries, type TestZipEntry } from './ooxml.test-helper.js';

const LIMITS: WorkerLimits = {
  maxTextChars: 100_000,
  maxSegments: 1000,
  maxPartBytes: 1024 * 1024,
  maxTotalBytes: 4 * 1024 * 1024,
  maxPdfPages: 10,
  maxPdfObjects: 100,
};
const run = (bytes: Buffer, limits: WorkerLimits = LIMITS): WorkerReply =>
  extractInWorker({ mediaType: XLSX, bytes, limits }, new Map([[XLSX, extractXlsx]]));
const cells = (reply: WorkerReply) => {
  assert.ok(reply.ok, JSON.stringify(reply));
  return reply.segments.map((s) => [s.locator.sheetIndex, s.locator.cell, s.text]);
};
const row = (r: number, content: string) => `<row r="${r}">${content}</row>`;

test('inline and shared strings, numbers and every cached value type become cell segments', () => {
  const sheet =
    row(1, inlineCell('A1', 'metric') + '<c r="B1" t="s"><v>0</v></c>') +
    row(2, '<c r="A2"><v>0.91</v></c><c r="B2" t="n"><v>12</v></c><c r="C2" t="b"><v>1</v></c>') +
    row(
      3,
      '<c r="A3" t="str"><f>A2*2</f><v>1.82</v></c><c r="B3" t="e"><v>#N/A</v></c><c r="C3" t="d"><v>2026-09-27</v></c>',
    ) +
    row(7, '<c r="B7" t="s"><v>1</v></c><c r="C7" t="b"><v>0</v></c>');
  const reply = run(
    buildTestZip(xlsxEntries([{ name: 'Checklist', cells: sheet }], { sharedStrings: ['ใช่', 'Yes'] })),
  );
  assert.deepEqual(cells(reply), [
    [1, 'A1', 'metric'],
    [1, 'B1', 'ใช่'],
    [1, 'A2', '0.91'],
    [1, 'B2', '12'],
    [1, 'C2', 'TRUE'],
    [1, 'A3', '1.82'],
    [1, 'B3', '#N/A'],
    [1, 'C3', '2026-09-27'],
    [1, 'B7', 'Yes'],
    [1, 'C7', 'FALSE'],
  ]);
  assert.ok(reply.ok);
  for (const s of reply.segments) assert.deepEqual(Object.keys(s.locator), ['kind', 'sheetIndex', 'cell']);
  assert.equal(reply.segments[0]!.locator.kind, 'cell');
});

test('sheets are numbered in workbook order, resolved through the workbook relationships', () => {
  const entries = xlsxEntries([
    {
      name: 'Summary',
      cells: row(1, inlineCell('A1', 'first sheet')),
      target: 'worksheets/zeta.xml',
      part: 'xl/worksheets/zeta.xml',
    },
    {
      name: 'Sheet3',
      cells: row(2, inlineCell('C2', 'second sheet')),
      target: '/xl/worksheets/alpha.xml',
      part: 'xl/worksheets/alpha.xml',
    },
  ]);
  assert.deepEqual(cells(run(buildTestZip(entries))), [
    [1, 'A1', 'first sheet'],
    [2, 'C2', 'second sheet'],
  ]);
});

test('without workbook relationships, sheet N is xl/worksheets/sheetN.xml', () => {
  const entries = xlsxEntries(
    [
      { name: 'One', cells: row(1, inlineCell('A1', 'one')) },
      { name: 'Two', cells: row(1, inlineCell('A1', 'two')) },
    ],
    { rels: false },
  );
  assert.deepEqual(cells(run(buildTestZip(entries))), [
    [1, 'A1', 'one'],
    [2, 'A1', 'two'],
  ]);
});

test('blank cells, empty values and phonetic runs yield nothing; rich runs join', () => {
  const sheet =
    row(1, '<c r="A1"/><c r="B1" t="inlineStr"><is><t>  </t></is></c><c r="C1"><v></v></c>') +
    row(
      2,
      '<c r="A2" t="inlineStr"><is><r><t>Hallu</t></r><r><t>cination</t></r><rPh sb="0" eb="1"><t>phonetic</t></rPh></is></c>',
    ) +
    row(3, '<c r="A3" t="s"><v>0</v></c>');
  const entries = xlsxEntries([{ name: 'S', cells: sheet }], { sharedStrings: [] });
  const shared = entries.map((e) =>
    e.name === 'xl/sharedStrings.xml'
      ? {
          ...e,
          data: `<sst xmlns="${S_NS}"><si><r><t>rich </t></r><r><t>text</t></r><rPh><t>x</t></rPh></si></sst>`,
        }
      : e,
  );
  assert.deepEqual(cells(run(buildTestZip(shared))), [
    [1, 'A2', 'Hallucination'],
    [1, 'A3', 'rich text'],
  ]);
});

test('a prefixed SpreadsheetML namespace and Strict OOXML read the same', () => {
  const plain = buildTestZip(xlsxEntries([{ name: 'S', cells: row(1, inlineCell('A1', 'value')) }]));
  const strictEntries = xlsxEntries([{ name: 'S', cells: row(1, inlineCell('A1', 'value')) }]).map((e) => ({
    ...e,
    data: String(e.data)
      .replaceAll(S_NS, 'http://purl.oclc.org/ooxml/spreadsheetml/main')
      .replaceAll(
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
        'http://purl.oclc.org/ooxml/officeDocument/relationships',
      ),
  }));
  const prefixed = xlsxEntries([{ name: 'S', cells: row(1, inlineCell('A1', 'value')) }]).map((e) =>
    e.name === 'xl/worksheets/sheet1.xml'
      ? {
          ...e,
          data: `<x:worksheet xmlns:x="${S_NS}"><x:sheetData><x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>value</x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>`,
        }
      : e,
  );
  assert.deepEqual(run(buildTestZip(strictEntries)), run(plain));
  assert.deepEqual(run(buildTestZip(prefixed)), run(plain));
});

test('a cell reference missing or outside the A1 pattern is unreadable', () => {
  for (const ref of ['a1', 'A0', 'AAAA1', 'A12345678', '1A', 'A 1', 'Sheet1!A1', 'A01'])
    assert.deepEqual(
      run(buildTestZip(xlsxEntries([{ name: 'S', cells: row(1, inlineCell(ref, 'x')) }]))),
      { ok: false, reason: 'unreadable' },
      ref,
    );
  assert.deepEqual(
    run(buildTestZip(xlsxEntries([{ name: 'S', cells: row(1, '<c t="inlineStr"><is><t>x</t></is></c>') }]))),
    { ok: false, reason: 'unreadable' },
  );
  assert.deepEqual(
    cells(
      run(
        buildTestZip(
          xlsxEntries([
            { name: 'S', cells: row(1, inlineCell('XFD1048576', 'x') + inlineCell('ZZZ9999999', 'y')) },
          ]),
        ),
      ),
    ),
    [
      [1, 'XFD1048576', 'x'],
      [1, 'ZZZ9999999', 'y'],
    ],
  );
});

test('inconsistent workbooks are unreadable', () => {
  const one = [{ name: 'S', cells: row(1, inlineCell('A1', 'x')) }];
  const without = (name: string): TestZipEntry[] => xlsxEntries(one).filter((e) => e.name !== name);
  const cases: Array<[string, TestZipEntry[]]> = [
    ['no workbook', without('xl/workbook.xml')],
    ['no sheet part', without('xl/worksheets/sheet1.xml')],
    [
      'shared index out of range',
      xlsxEntries([{ name: 'S', cells: row(1, '<c r="A1" t="s"><v>3</v></c>') }], { sharedStrings: ['a'] }),
    ],
    [
      'shared index not a number',
      xlsxEntries([{ name: 'S', cells: row(1, '<c r="A1" t="s"><v>x</v></c>') }], { sharedStrings: ['a'] }),
    ],
    [
      'shared string without the part',
      xlsxEntries([{ name: 'S', cells: row(1, '<c r="A1" t="s"><v>0</v></c>') }]),
    ],
    [
      'relationship missing',
      xlsxEntries(one).map((e) =>
        e.name === 'xl/_rels/workbook.xml.rels'
          ? {
              ...e,
              data: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
            }
          : e,
      ),
    ],
    ['relationship escapes the package', xlsxEntries([{ ...one[0]!, target: '../../../etc/passwd' }])],
    [
      'DOCTYPE in a sheet',
      xlsxEntries(one).map((e) =>
        e.name === 'xl/worksheets/sheet1.xml'
          ? { ...e, data: `<!DOCTYPE x>${String(e.data).replace(/^<\?xml[^>]*>\n/, '')}` }
          : e,
      ),
    ],
    ['no sheets', xlsxEntries([])],
    ['only blank cells', xlsxEntries([{ name: 'S', cells: row(1, '<c r="A1"/>') }])],
  ];
  for (const [name, entries] of cases)
    assert.deepEqual(run(buildTestZip(entries)), { ok: false, reason: 'unreadable' }, name);
});

test('output over the text or segment cap is limit_output', () => {
  const sheet = Array.from({ length: 30 }, (_, i) => row(i + 1, inlineCell(`A${i + 1}`, `cell ${i}`))).join(
    '',
  );
  const bytes = buildTestZip(xlsxEntries([{ name: 'S', cells: sheet }]));
  assert.deepEqual(run(bytes, { ...LIMITS, maxSegments: 29 }), { ok: false, reason: 'limit_output' });
  assert.deepEqual(run(bytes, { ...LIMITS, maxTextChars: 100 }), { ok: false, reason: 'limit_output' });
});
