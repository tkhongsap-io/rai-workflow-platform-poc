// W4-05c (W4b plan section 4.3): the worker's XML tokenizer. It refuses a DOCTYPE and any other declaration, expands
// only the five predefined and numeric references, resolves namespaces, and refuses malformed markup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExtractionStop } from './sink.js';
import { attributeOf, decodeXml, xmlEvents, type XmlEvent } from './xml.js';

const events = (source: string): XmlEvent[] => [...xmlEvents(source)];
const compact = (source: string) =>
  events(source).map((e) =>
    e.type === 'text' ? `"${e.text}"` : e.type === 'open' ? `<${e.ns}|${e.local}>` : `</${e.ns}|${e.local}>`,
  );
function unreadable(source: string, message = source) {
  assert.throws(
    () => events(source),
    (e) => e instanceof ExtractionStop && e.reason === 'unreadable',
    message,
  );
}

test('elements, text and self-closing tags become open, text and close events', () => {
  assert.deepEqual(compact('<?xml version="1.0" encoding="UTF-8"?>\n<a><b>hi</b><c/></a>'), [
    '<|a>',
    '<|b>',
    '"hi"',
    '</|b>',
    '<|c>',
    '</|c>',
    '</|a>',
  ]);
});

test('namespaces resolve through default and prefixed declarations, scoped to the element', () => {
  const source =
    '<w:doc xmlns:w="urn:w" xmlns="urn:d"><w:p><x/></w:p><inner xmlns="urn:e"><y/></inner><z/></w:doc>';
  assert.deepEqual(compact(source), [
    '<urn:w|doc>',
    '<urn:w|p>',
    '<urn:d|x>',
    '</urn:d|x>',
    '</urn:w|p>',
    '<urn:e|inner>',
    '<urn:e|y>',
    '</urn:e|y>',
    '</urn:e|inner>',
    '<urn:d|z>',
    '</urn:d|z>',
    '</urn:w|doc>',
  ]);
  const unbound = events('<q:a/>')[0]!;
  assert.equal(unbound.type === 'open' && unbound.ns.startsWith('urn:rai-unbound:'), true);
});

test('attributes are decoded and namespace-qualified; unprefixed attributes have no namespace', () => {
  const open = events(`<a xmlns:r="urn:r" id='x&amp;y' r:id="rId1" note="&#x41;&#66;"/>`)[0]!;
  assert.equal(open.type, 'open');
  assert.equal(attributeOf(open, '', 'id'), 'x&y');
  assert.equal(attributeOf(open, 'urn:r', 'id'), 'rId1');
  assert.equal(attributeOf(open, '', 'note'), 'AB');
  assert.equal(attributeOf(open, '', 'missing'), undefined);
});

test('only the five predefined and numeric references expand', () => {
  const text = events('<a>&lt;&gt;&amp;&quot;&apos;&#3585;&#x0E01;</a>')
    .filter((e) => e.type === 'text')
    .map((e) => (e.type === 'text' ? e.text : ''))
    .join('');
  assert.equal(text, `<>&"'กก`);
  for (const bad of ['&nbsp;', '&bogus;', '& ', '&#0;', '&#xD800;', '&#x110000;', '&#;', '&#x;', '&amp'])
    unreadable(`<a>${bad}</a>`);
  unreadable('<a b="&ent;"/>');
});

test('a DOCTYPE, an ENTITY or any other declaration is unreadable', () => {
  unreadable('<!DOCTYPE a><a/>');
  unreadable('<?xml version="1.0"?>\n<!DOCTYPE w:document [<!ENTITY e "x">]>\n<a>&e;</a>');
  unreadable('<a><!ENTITY e "x"></a>');
  unreadable('<a><!ELEMENT a ANY></a>');
  unreadable('<a/><!doctype a>');
});

test('comments, CDATA and processing instructions are handled', () => {
  assert.deepEqual(compact('<a><!-- c --><![CDATA[<raw>&amp;]]><?pi x?></a>'), [
    '<|a>',
    '"<raw>&amp;"',
    '</|a>',
  ]);
});

test('malformed markup is unreadable', () => {
  for (const bad of [
    '',
    '   ',
    'text only',
    '<a>',
    '<a></b>',
    '<a><b></a></b>',
    '</a>',
    '<a/><b/>',
    '<a/>tail',
    '<a b="1" b="2"/>',
    '<a b=1/>',
    '<a b="<"/>',
    '<a b="1"',
    '<a><!-- open',
    '<a><![CDATA[ open',
    '<a><?pi open',
    '<1a/>',
    '<a xmlns:p=""/>',
  ])
    unreadable(bad, JSON.stringify(bad));
});

test('a declared encoding other than UTF-8 is unreadable', () => {
  unreadable('<?xml version="1.0" encoding="UTF-16"?><a/>');
  unreadable(`<?xml version="1.0" encoding='windows-874'?><a/>`);
  assert.equal(events(`<?xml version="1.0" encoding='utf-8'?><a/>`).length, 2);
});

test('decodeXml is strict UTF-8, drops a BOM, refuses UTF-16 and normalises line ends', () => {
  assert.equal(decodeXml(Buffer.from('﻿<a>ก\r\nx\ry</a>', 'utf8')), '<a>ก\nx\ny</a>');
  for (const bad of [
    Buffer.from([0x3c, 0x61, 0x3e, 0xff, 0xfe, 0x3c, 0x2f, 0x61, 0x3e]),
    Buffer.from([0xff, 0xfe, 0x3c, 0x00]),
    Buffer.from([0xfe, 0xff, 0x00, 0x3c]),
  ])
    assert.throws(
      () => decodeXml(bad),
      (e) => e instanceof ExtractionStop && e.reason === 'unreadable',
    );
});

test('a long flat document tokenizes in linear time', () => {
  const body = '<p><t>x</t></p>'.repeat(200_000);
  const started = performance.now();
  let count = 0;
  for (const _ of xmlEvents(`<doc>${body}</doc>`)) count += 1;
  assert.equal(count, 2 + 200_000 * 5);
  assert.ok(performance.now() - started < 5000);
});
