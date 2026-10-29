import test from 'node:test';
import assert from 'node:assert/strict';
import EventBus from '../../src/renderer/js/core/EventBus.js';
import History from '../../src/renderer/js/core/History.js';
import LayerManager from '../../src/renderer/js/graphics/LayerManager.js';
import BrushTool from '../../src/renderer/js/tools/BrushTool.js';
import PencilTool from '../../src/renderer/js/tools/PencilTool.js';
import EraserTool from '../../src/renderer/js/tools/EraserTool.js';
import BucketTool from '../../src/renderer/js/tools/BucketTool.js';
import GradientTool from '../../src/renderer/js/tools/GradientTool.js';
import RectTool from '../../src/renderer/js/tools/RectTool.js';
import LineTool from '../../src/renderer/js/tools/LineTool.js';
import CircleTool from '../../src/renderer/js/tools/CircleTool.js';
import {combineSelection,containsPixel} from '../../src/renderer/js/tools/SelectionGeometry.mjs';
import {RasterCanvas} from '../helpers/raster-canvas.mjs';

const area=combineSelection({x:2,y:2,width:8,height:8},{x:4,y:4,width:3,height:3},'subtract');
function fixture(t,Type,...args){
    const oldDocument=globalThis.document,oldWindow=globalThis.window;t.after(()=>{globalThis.document=oldDocument;globalThis.window=oldWindow;});
    globalThis.document={getElementById:()=>null,createElement:()=>new RasterCanvas()};globalThis.window={};
    const bus=new EventBus(),layers=new LayerManager(bus,{width:12,height:12}),history=new History(bus),layer=layers.addLayer('Drawing');
    const tool=new Type(bus,layers,history,...args);tool.toolManager={tools:{marquee:{selection:area}}};
    return {tool,layer,layers,history};
}
function checkMask(layer,before,changed){
    let count=0;for(let y=0;y<12;y++)for(let x=0;x<12;x++){
        const offset=(y*12+x)*4,pixel=layer.canvas.data.subarray(offset,offset+4);
        if(!containsPixel(area,x,y))assert.deepEqual(pixel,before.subarray(offset,offset+4),`outside mask at ${x},${y}`);
        else if(changed(pixel,before.subarray(offset,offset+4)))count++;
    }
    assert.ok(count>0,'selected pixels should change');assert.equal(layer.ctx.stack?.length||0,0);
}

for(const [name,Type] of [['brush',BrushTool],['pencil',PencilTool]])test(`${name} respects a compound selection with a hole and remains undoable`,t=>{
    const {tool,layer,history}=fixture(t,Type),before=layer.canvas.data.slice();
    tool.onPointerDown(0,5,'#ff0000',3,layer);tool.onPointerMove(11,5,'#ff0000',3,layer);tool.onPointerUp(11,5,'#ff0000',3,layer);
    checkMask(layer,before,pixel=>pixel[3]>0);assert.equal(history.undoStack.length,1);
    const after=layer.canvas.data.slice();history.undo();assert.deepEqual(layer.canvas.data,before);history.redo();assert.deepEqual(layer.canvas.data,after);
});

test('pixel-perfect pencil never modifies the hole while correcting corners',t=>{
    const {tool,layer,history}=fixture(t,PencilTool),before=layer.canvas.data.slice();
    tool.onPointerDown(2,3,'#ff0000',1,layer);
    for(const [x,y] of [[3,3],[3,4],[4,4],[4,5],[5,5],[5,6],[6,6],[6,7],[7,7]])tool.onPointerMove(x,y,'#ff0000',1,layer);
    tool.onPointerUp(7,7,'#ff0000',1,layer);checkMask(layer,before,pixel=>pixel[3]>0);
    history.undo();assert.deepEqual(layer.canvas.data,before);
});

test('eraser keeps pixels outside the mask and inside its hole intact',t=>{
    const {tool,layer,history}=fixture(t,EraserTool);layer.ctx.fillStyle='#5588cc';layer.ctx.fillRect(0,0,12,12);layer.invalidateSource();
    const before=layer.canvas.data.slice();tool.onPointerDown(0,5,'',3,layer);tool.onPointerUp(11,5,'',3,layer);
    checkMask(layer,before,pixel=>pixel[3]===0);history.undo();assert.deepEqual(layer.canvas.data,before);
});

test('bucket contiguous fill follows the selection ring without leaking through its hole',t=>{
    const {tool,layer,history}=fixture(t,BucketTool),before=layer.canvas.data.slice();
    tool.onPointerDown(2,2,'#ff0000',1,layer);tool.onPointerUp();
    checkMask(layer,before,pixel=>pixel[3]>0);
    for(let y=0;y<12;y++)for(let x=0;x<12;x++)assert.equal(layer.canvas.data[(y*12+x)*4+3],containsPixel(area,x,y)?255:0);
    history.undo();assert.deepEqual(layer.canvas.data,before);
});

test('live gradient uses the shared selection clip and preserves unselected pixels',t=>{
    const {tool,layer,history}=fixture(t,GradientTool),before=layer.canvas.data.slice();
    tool.renderGradient=ctx=>{ctx.fillStyle='#ff0000';ctx.fillRect(0,0,12,12);};
    tool.onPointerDown(2,2,'#ff0000',1,layer);tool.onPointerUp(9,2,'#ff0000',1,layer);
    checkMask(layer,before,pixel=>pixel[3]>0);history.undo();assert.deepEqual(layer.canvas.data,before);
});

for(const [name,Type] of [['line',LineTool],['rectangle',RectTool],['ellipse',CircleTool]])test(`a ${name} cropped by selection becomes a masked bitmap with correct undo/redo`,t=>{
    const {tool,layer,layers,history}=fixture(t,Type,true);
    tool.onPointerDown(0,0,'#ff0000',1,layer);tool.onPointerUp(11,11,'#ff0000',1,layer);
    assert.equal(layers.layers.length,2);const object=layers.getActiveLayer();
    assert.equal(object.shapeData,null);checkMask(object,new Uint8ClampedArray(12*12*4),pixel=>pixel[3]>0);
    const after=object.canvas.data.slice();history.undo();assert.deepEqual(layers.layers,[layer]);history.redo();assert.deepEqual(object.canvas.data,after);
});

test('alpha-locked painting inside the mask preserves alpha and all initially transparent pixels',t=>{
    const {tool,layer,history}=fixture(t,BrushTool);
    layer.ctx.fillStyle='#001122';layer.ctx.fillRect(3,3,5,5);layer.invalidateSource();layer.alphaLocked=true;
    const before=layer.canvas.data.slice();tool.onPointerDown(0,3,'#ff0000',3,layer);tool.onPointerUp(11,3,'#ff0000',3,layer);
    checkMask(layer,before,(pixel,previous)=>pixel[0]!==previous[0]);
    for(let index=3;index<before.length;index+=4)assert.equal(layer.canvas.data[index],before[index]);
    history.undo();assert.deepEqual(layer.canvas.data,before);
});
