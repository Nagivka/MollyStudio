import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeColorHistory} from '../../src/renderer/js/core/ColorHistory.mjs';
test('color history validates, deduplicates and bounds saved colors',()=>{
    assert.deepEqual(normalizeColorHistory(null),{recent:[],pinned:[]});
    assert.deepEqual(normalizeColorHistory({recent:['#aabbcc','#AABBCC','bad',null,42,'#123456'],pinned:['#ffffff','#fff']}),{recent:['#AABBCC','#123456'],pinned:['#FFFFFF']});
    const colors=Array.from({length:100},(_,i)=>'#'+i.toString(16).padStart(6,'0'));
    assert.equal(normalizeColorHistory({recent:colors,pinned:colors}).recent.length,24);
    assert.equal(normalizeColorHistory({recent:colors,pinned:colors}).pinned.length,12);
});
