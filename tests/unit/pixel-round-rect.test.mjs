import test from 'node:test';
import assert from 'node:assert/strict';
import {roundedRowInset} from '../../src/renderer/js/tools/PixelRoundRect.mjs';
test('scanline rounded corners agree with direct pixel-centre circle tests',()=>{
    for(const [w,h] of [[1,1],[2,3],[5,5],[12,7],[31,24],[64,64]])for(const radius of [0,1,3,8,100]){
        const r=Math.min(radius,w/2,h/2);
        for(let y=0;y<h;y++)for(let x=0;x<w;x++){
            const dx=Math.max(0,r-x-.5,x+.5-(w-r)),dy=Math.max(0,r-y-.5,y+.5-(h-r));
            const reference=dx*dx+dy*dy<=r*r+1e-8,cut=roundedRowInset(w,h,radius,y);
            assert.equal(x>=cut&&x<w-cut,reference,`${w}x${h} radius ${radius} at ${x},${y}`);
            assert.equal(cut,roundedRowInset(w,h,radius,h-y-1));
        }
    }
});
