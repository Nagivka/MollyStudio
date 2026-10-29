import test from 'node:test';
import assert from 'node:assert/strict';
import {pencilTipContains as inside} from '../../src/renderer/js/tools/PencilTip.mjs';
import PencilTool from '../../src/renderer/js/tools/PencilTool.js';
test('round pencil tips remain symmetric and fill their requested diameter at every size',()=>{
    for(let size=1;size<=64;size++){
        const pixels=[];
        PencilTool.prototype.drawStamp.call({}, {set fillStyle(v){},fillRect(x,y){pixels.push([x,y]);}},50,50,'#FFFFFF',size);
        const offset=50-Math.floor(size/2),actual=new Set(pixels.map(([x,y])=>(x-offset)+','+(y-offset)));
        assert.equal(Math.max(...pixels.map(p=>p[0]))-Math.min(...pixels.map(p=>p[0]))+1,size);
        for(let y=0;y<size;y++)for(let x=0;x<size;x++){
            assert.equal(inside(size,x,y),inside(size,size-1-x,y));assert.equal(inside(size,x,y),inside(size,y,x));
            assert.equal(actual.has(x+','+y),inside(size,x,y));
        }
    }
});
test('larger pencil tips have rounded caps rather than pinched one-pixel poles',()=>{
    assert.deepEqual(Array.from({length:5},(_,y)=>Array.from({length:5},(_,x)=>inside(5,x,y)).filter(Boolean).length),[3,5,5,5,3]);
    assert.deepEqual(Array.from({length:6},(_,y)=>Array.from({length:6},(_,x)=>inside(6,x,y)).filter(Boolean).length),[4,6,6,6,6,4]);
});
