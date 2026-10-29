import test from 'node:test';
import assert from 'node:assert/strict';
import {combineSelection,containsPixel,transformSelection,selectionEdges,selectionFromAlpha,maskPixels} from '../../src/renderer/js/tools/SelectionGeometry.mjs';
const rect=(x,y,width,height)=>({x,y,width,height});

test('rectangle boolean operations match every pixel, including holes',()=>{
    const a=rect(0,0,6,6),b=rect(2,2,2,2);
    for(const mode of ['add','subtract','intersect']){
        const result=combineSelection(a,b,mode);
        for(let y=-1;y<8;y++)for(let x=-1;x<8;x++){
            const left=containsPixel(a,x,y),right=containsPixel(b,x,y);
            assert.equal(containsPixel(result,x,y),mode==='add'?left||right:mode==='subtract'?left&&!right:left&&right);
        }
    }
    const inverse=combineSelection(a,b,'subtract');assert.equal(selectionEdges(inverse).reduce((s,e)=>s+e.length,0),32);
    assert.equal(combineSelection(a,a,'subtract'),null);
});

test('moving, resizing and reflecting regions preserves their holes',()=>{
    const selection=combineSelection(rect(0,0,4,4),rect(0,0,2,2),'subtract');
    const moved=transformSelection(selection,rect(10,20,8,8));
    assert.equal(containsPixel(moved,11,21),false);assert.equal(containsPixel(moved,15,21),true);
    const flipped=transformSelection(selection,selection,{flipX:true});assert.equal(containsPixel(flipped,3,0),false);
});

test('alpha selection merges vertical runs and keeps transparent holes unselected',()=>{
    const image={width:4,height:4,data:new Uint8ClampedArray(64).fill(255)};image.data[(1*4+1)*4+3]=0;
    const selection=selectionFromAlpha(image);assert.equal(containsPixel(selection,1,1),false);assert.equal(containsPixel(selection,2,2),true);
    const masked=maskPixels({width:4,height:4,data:new Uint8ClampedArray(64).fill(255)},0,0,selection);
    assert.equal(masked.data[(1*4+1)*4+3],0);assert.equal(masked.data[(2*4+2)*4+3],255);
});

test('indexed selection membership matches a reference bitmap after many combinations',()=>{
    let seed=17,selection=null;const bitmap=new Uint8Array(32*32);
    const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
    for(let step=0;step<150;step++){
        const r=rect(random(24),random(24),1+random(8),1+random(8)),mode=['add','subtract','intersect'][random(3)];
        selection=combineSelection(selection,r,mode);
        for(let y=0;y<32;y++)for(let x=0;x<32;x++){
            const i=y*32+x,inside=x>=r.x&&y>=r.y&&x<r.x+r.width&&y<r.y+r.height;
            bitmap[i]=mode==='add'?bitmap[i]||inside:mode==='subtract'?bitmap[i]&&!inside:bitmap[i]&&inside;
            assert.equal(containsPixel(selection,x,y),Boolean(bitmap[i]));
        }
    }
});
