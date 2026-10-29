import test from 'node:test';
import assert from 'node:assert/strict';
import {compactImagePair} from '../../src/renderer/js/core/PixelPatch.mjs';
import {DrawCommand} from '../../src/renderer/js/core/Commands.js';
import {estimateCommandBytes} from '../../src/renderer/js/core/History.js';
const image=(w=128,h=128)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4),mollySnapshot:{type:'bitmap',sourceCanvas:null}});

test('sparse history retains a small rectangle with exact alpha and source metadata',()=>{
    const before=image(),after=image();after.data.set([13,29,61,127],(17*128+19)*4);
    const pair=compactImagePair(before,after);assert.equal(pair.after.x,19);assert.equal(pair.after.y,17);
    assert.equal(pair.after.patchWidth,1);assert.deepEqual([...pair.after.data],[13,29,61,127]);assert.equal(pair.before.data.byteLength,4);
    assert.equal(pair.before.mollySnapshot,before.mollySnapshot);
});

test('size-changing and dense edits keep complete history snapshots',()=>{
    assert.equal(compactImagePair(image(),image(64,64)),null);
    const before=image(),after=image();after.data.fill(255);assert.equal(compactImagePair(before,after),null);
});

test('metadata-only history has no pixel allocation and restores the right snapshot',()=>{
    const before=image(),after=image(),states=[];after.mollySnapshot.sourceRect={x:1,y:2,w:3,h:4};
    const command=new DrawCommand({applyPixelPatch:patch=>states.push(patch.mollySnapshot)},before,after);
    assert.equal(command.afterData.data.length,0);assert.ok(estimateCommandBytes(command)<1024);
    command.undo();command.execute();assert.deepEqual(states,[before.mollySnapshot,after.mollySnapshot]);
});
