import {performance} from 'node:perf_hooks';
import {equalGapSnap} from '../src/renderer/js/tools/SmartGuides.mjs';
import {planLayerDrop} from '../src/renderer/js/core/LayerOrganization.mjs';
import {drawLayers} from '../src/renderer/js/graphics/LayerCompositing.js';
import {imageDataEquals} from '../src/renderer/js/core/ImageDataUtils.js';
import {compactImagePair} from '../src/renderer/js/core/PixelPatch.mjs';

// Algorithm timings only. Canvas contexts below count calls; they do not draw
// pixels, allocate graphics memory or measure Chromium/GPU frame rates.
function measure(name,run,iterations=1000,warmup=Math.min(50,iterations)){
    for(let i=0;i<warmup;i++)run();
    const samples=[];
    for(let i=0;i<iterations;i++){const start=performance.now();run();samples.push(performance.now()-start);}
    samples.sort((a,b)=>a-b);
    return {name,iterations,medianMs:+samples[Math.floor(iterations*.5)].toFixed(4),p95Ms:+samples[Math.floor(iterations*.95)].toFixed(4)};
}

const references=Array.from({length:511},(_,i)=>({x:i*20,y:0,w:10,h:10}));
const layers=[];
for(let i=0;i<64;i++){
    for(let j=0;j<7;j++)layers.push({id:`leaf${i}-${j}`,groupId:`g${i}`});
    layers.push({id:`g${i}`,isGroup:true});
}
const timings=[
    measure('Equal-gap search among 511 objects',()=>equalGapSnap({x:9951,y:0,w:10,h:10},references,3)),
    measure('Plan branch reparenting among 512 layers',()=>planLayerDrop(layers,'g10','g60','inside'))
];

let allocations=0,draws=0;
const context=()=>({save(){},restore(){},clearRect(){},drawImage(){draws++;}});
globalThis.document={createElement(){allocations++;return {width:0,height:0,getContext:context};}};
const nested=Array.from({length:160},(_,i)=>({id:`nested${i}`,isGroup:true,width:8,height:8,groupId:i?`nested${i-1}`:null}));
const leaf={id:'pixel',canvas:{},contentRevision:1,groupId:'nested159'};nested.push(leaf);
const target=context(),frames=[];
for(const name of ['First render','Unchanged render','Render after pixel edit']){
    if(frames.length===2)leaf.contentRevision++;
    const beforeDraws=draws,beforeAllocations=allocations;
    drawLayers(target,nested);
    frames.push({name,drawCalls:draws-beforeDraws,newGroupCanvases:allocations-beforeAllocations});
}
timings.push(measure('Cached traversal of 160 nested groups',()=>drawLayers(target,nested)));
// Real RGBA buffers exercise the exact comparison/patch code used by drawing
// tools. These measure CPU work, independently of canvas readback and GPU memory.
const width=2048,height=2048;
const before={width,height,data:new Uint8ClampedArray(width*height*4).fill(127)};
const after={width,height,data:before.data.slice()};
timings.push(measure('Compare equal 2048x2048 RGBA snapshots',()=>imageDataEquals(before,after),25,3));
after.data.set([13,29,61,128],((height-1)*width+width-1)*4);
timings.push(measure('Compare snapshots differing in the last pixel',()=>imageDataEquals(before,after),25,3));
timings.push(measure('Compact one changed pixel on a 2048x2048 layer',()=>compactImagePair(before,after),25,3));
const sparse=compactImagePair(before,after);
after.data.fill(255);
timings.push(measure('Detect a dense 2048x2048 edit',()=>compactImagePair(before,after),25,3));
process.stdout.write(JSON.stringify({runtime:process.version,scope:'JavaScript CPU algorithms; real typed RGBA buffers and mock canvas contexts, no Chromium/GPU/native memory measurement',timings,groupCache:frames,historyBuffers:{fullPairBytes:before.data.byteLength+after.data.byteLength,singlePixelPairBytes:sparse.before.data.byteLength+sparse.after.data.byteLength}},null,2)+'\n');
