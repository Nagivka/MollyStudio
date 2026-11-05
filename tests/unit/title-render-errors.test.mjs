import test from 'node:test';
import assert from 'node:assert/strict';
import TitleRenderer from '../../src/renderer/js/graphics/TitleRenderer.js';
import {normalizeTitleDocument} from '../../src/renderer/js/core/TitleDocument.mjs';

test('PNG export rejects an incomplete GPU render instead of returning an empty image',()=>{
 for(const contextLost of [false,true]){
  let drawn=false;
  const bounds={min:[-1,-1,0],max:[1,1,1]};
  const renderer={
   prepare:()=>normalizeTitleDocument({resolution:64}),mesh:{bounds,baseBounds:bounds},
   gl:{MAX_RENDERBUFFER_SIZE:1,NO_ERROR:0,getParameter:()=>4096,isContextLost:()=>drawn&&contextLost,getError:()=>1285},
   draw(){drawn=true;}
  };
  assert.throws(()=>TitleRenderer.prototype.renderSnapshot.call(renderer,{}),contextLost?/3D-контекст/:/Уменьшите разрешение/);
  assert.equal(drawn,true);
 }
});
