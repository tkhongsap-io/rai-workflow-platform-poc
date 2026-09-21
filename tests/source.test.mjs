import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('entry preserves exact authored design except declared bootstrap and functional corrections',()=>{
 const original=read('demo/reference/Main.dc.html');
 let expected=original.replace('<script src="./support.js"></script>','<meta name="viewport" content="width=device-width, initial-scale=1">\n<script src="./runtime.js" defer></script>');
 for (const patch of JSON.parse(read('demo/reference/local-adaptations.json'))) {
  assert.equal(expected.split(patch.before).length - 1, 1, patch.reason);
  expected = expected.replace(patch.before, patch.after);
 }
 assert.equal(createHash('sha256').update(original).digest('hex'),'1ce66733ae19f0e9e0b53bb6adfcf72d80d4da657690703939002758c6877017');
 assert.equal(read('demo/index.html'),expected);
});
test('frozen product source remains unchanged',()=>{
 assert.equal(createHash('sha256').update(read('docs/product/source-spec.md')).digest('hex'),'92c4f7123058b8fec3c2ba7abdf10538fad034778624b0675975b39de440b354');
});
