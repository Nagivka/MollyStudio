import test from 'node:test';
import assert from 'node:assert/strict';
import {imageDataEquals} from '../../src/renderer/js/core/ImageDataUtils.js';
import {compactImagePair} from '../../src/renderer/js/core/PixelPatch.mjs';
import {DrawCommand} from '../../src/renderer/js/core/Commands.js';

test('pixel equality matches a byte reference for aligned, unaligned and ordinary arrays',()=>{
    let seed=7;const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
    for(const length of [0,1,2,3,4,7,32,1025])for(const offset of [0,3,8]){
        const a=new Uint8ClampedArray(new ArrayBuffer(length+offset),offset,length);
        const b=new Uint8Array(new ArrayBuffer(length+offset),offset,length);
        for(let i=0;i<length;i++)a[i]=b[i]=random(256);
        const image=data=>({width:1,height:length,data});
        assert.equal(imageDataEquals(image(a),image(b)),true);
        assert.equal(imageDataEquals(image(a),image(a)),true);
        for(let step=0;step<12&&length;step++){
            b[random(length)]=random(256);
            const expected=a.every((value,index)=>value===b[index]);
            for(const [left,right] of [[a,b],[[...a],[...b]]])assert.equal(imageDataEquals(image(left),image(right)),expected);
        }
    }
    const buffer=Uint8Array.from([1,2,3,4,4,3,2,1]);
    assert.equal(imageDataEquals({width:1,height:1,data:buffer.subarray(0,4)},{width:1,height:1,data:buffer.subarray(4,8)}),false);
});

test('pixel comparison detects every channel of the last pixel on a large image',()=>{
    const first={width:2048,height:2048,data:new Uint8ClampedArray(2048*2048*4).fill(128)};
    const second={width:2048,height:2048,data:first.data.slice()};
    for(let channel=0;channel<4;channel++){
        const index=first.data.length-4+channel;second.data[index]=129;
        assert.equal(imageDataEquals(first,second),false);second.data[index]=128;
    }
    assert.equal(imageDataEquals(first,second),true);
});

test('compact patches reproduce randomized edits and keep the previous density threshold',()=>{
    let seed=19;const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
    for(let sample=0;sample<100;sample++){
        const before={width:64,height:64,data:new Uint8ClampedArray(64*64*4),mollySnapshot:{type:'bitmap',contentRevision:1}};
        const after={width:64,height:64,data:before.data.slice(),mollySnapshot:{type:'bitmap',contentRevision:2}};
        let minX=64,minY=64,maxX=-1,maxY=-1;
        for(let index=0;index<random(64)+1;index++){
            const x=random(64),y=random(64),offset=(y*64+x)*4;
            after.data.set([13,29,61,127],offset);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
        }
        const pair=compactImagePair(before,after),area=(maxX-minX+1)*(maxY-minY+1);
        if(area>=64*64*.75){assert.equal(pair,null);continue;}
        assert.ok(pair);assert.equal(pair.before.mollySnapshot,before.mollySnapshot);assert.equal(pair.after.mollySnapshot,after.mollySnapshot);
        const restored=before.data.slice(),patch=pair.after;
        for(let row=0;row<patch.patchHeight;row++)restored.set(patch.data.subarray(row*patch.patchWidth*4,(row+1)*patch.patchWidth*4),((patch.y+row)*64+patch.x)*4);
        assert.deepEqual(restored,after.data);
    }
});

test('unaligned pixel snapshots retain full undo data instead of throwing in patch construction',()=>{
    const before={width:64,height:64,data:new Uint8ClampedArray(new ArrayBuffer(64*64*4+1),1)},after={width:64,height:64,data:new Uint8ClampedArray(new ArrayBuffer(64*64*4+1),1)};
    after.data[7]=255;const applied=[],layer={applyPixelPatch(){assert.fail('unaligned snapshots should not be compacted');},putImageData:image=>applied.push(image)};
    const command=new DrawCommand(layer,before,after);command.undo();command.execute();
    assert.deepEqual(applied,[before,after]);
});
