import test from 'node:test';
import assert from 'node:assert/strict';
import {leafSeason,summerLeafPixels,springLeafPixels} from '../../src/renderer/js/core/WeatherLeaves.mjs';
test('mixed leaves include all seasons, fixed selections stay fixed',()=>{
    assert.deepEqual([...new Set(Array.from({length:64},(_,i)=>leafSeason('all',i)))],['autumn','spring','summer']);
    for(const season of ['autumn','spring','summer'])for(let i=0;i<64;i++)assert.equal(leafSeason(season,i),season);
    assert.equal(leafSeason('bad',0),'autumn');
});
test('summer recoloring keeps alpha and shading while producing green leaves',()=>{
    const pixels=new Uint8ClampedArray([180,90,30,255,90,45,15,120,20,10,4,0]);
    summerLeafPixels(pixels);
    assert.deepEqual([pixels[3],pixels[7],pixels[11]],[255,120,0]);
    assert.ok(pixels[1]>pixels[0]&&pixels[1]>pixels[2]);
    assert.ok(pixels[1]>pixels[5]);
    assert.deepEqual([...pixels.slice(8)],[20,10,4,0]);
});
test('pink recoloring preserves leaf transparency and brightness differences',()=>{
    const pixels=new Uint8ClampedArray([180,90,30,255,90,45,15,120,20,10,4,0]);
    springLeafPixels(pixels);
    assert.deepEqual([pixels[3],pixels[7],pixels[11]],[255,120,0]);
    assert.ok(pixels[0]>pixels[2]&&pixels[2]>pixels[1]);
    assert.ok(pixels[0]>pixels[4]);
    assert.deepEqual([...pixels.slice(8)],[20,10,4,0]);
});
