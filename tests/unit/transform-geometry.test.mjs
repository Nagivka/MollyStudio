import test from 'node:test';
import assert from 'node:assert/strict';
import {boundsOf,resizeAtAnchor,alignmentOffsets,distributionOffsets} from '../../src/renderer/js/tools/TransformGeometry.mjs';

test('numeric resize preserves each of the nine reference anchors',()=>{
    for(const x of [0,.5,1])for(const y of [0,.5,1]){
        const box={x:10,y:20,w:12,h:8},next=resizeAtAnchor(box,24,16,{x,y});
        assert.equal(next.x+next.w*x,box.x+box.w*x);assert.equal(next.y+next.h*y,box.y+box.h*y);
    }
    assert.equal(resizeAtAnchor({x:0,y:0,w:1,h:1},Infinity,1),null);
});

test('odd-sized centred objects do not drift after repeated shrink and grow cycles',()=>{
    for(const x of [0,.5,1])for(const y of [0,.5,1])for(const origin of [-10,0,10]){
        const original={x:origin,y:origin,w:7,h:5};let box=original;
        for(let index=0;index<20;index++){
            box=resizeAtAnchor(box,2,2,{x,y});box=resizeAtAnchor(box,7,5,{x,y});
        }
        assert.deepEqual(box,original);
    }
});

test('all six alignments use the selected reference rectangle',()=>{
    const box={x:8,y:9,w:4,h:2},ref={x:10,y:20,w:20,h:10};
    for(const [type,dx,dy] of [['left',2,0],['center-h',10,0],['right',18,0],['top',0,11],['center-v',0,15],['bottom',0,19]]){
        assert.deepEqual(alignmentOffsets([box],type,ref),[{dx,dy}]);
    }
});

test('distribution uses equal gaps, stable order and preserves endpoints',()=>{
    const boxes=[{x:30,y:0,w:10,h:2},{x:0,y:0,w:4,h:2},{x:6,y:0,w:6,h:2}];
    const offsets=distributionOffsets(boxes);assert.deepEqual(offsets,[{dx:0,dy:0},{dx:0,dy:0},{dx:8,dy:0}]);
    assert.deepEqual(boundsOf(boxes),{x:0,y:0,w:40,h:2});assert.equal(boundsOf([]),null);
});
