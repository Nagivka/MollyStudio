import test from 'node:test';
import assert from 'node:assert/strict';
import EventBus from '../../src/renderer/js/core/EventBus.js';
import History from '../../src/renderer/js/core/History.js';
import LayerManager from '../../src/renderer/js/graphics/LayerManager.js';
import LayerPanel from '../../src/renderer/js/ui/LayerPanel.js';
import MarqueeTool from '../../src/renderer/js/tools/MarqueeTool.js';
import MoveTool from '../../src/renderer/js/tools/MoveTool.js';
import ToolManager from '../../src/renderer/js/tools/ToolManager.js';
import {RasterCanvas} from '../helpers/raster-canvas.mjs';

function scope(t,key,value){const old=globalThis[key];globalThis[key]=value;t.after(()=>{globalThis[key]=old;});}
function scene(t){
    scope(t,'document',{getElementById:()=>null,createElement:()=>new RasterCanvas()});
    const bus=new EventBus(),manager=new LayerManager(bus,{width:12,height:8}),history=new History(bus);
    const bottom=manager.addLayer('Bottom'),layer=manager.addLayer('Object');
    const master=new RasterCanvas(2,2);master.context.fillStyle='#ff0000';master.context.fillRect(0,0,2,2);
    layer.ctx.drawImage(master,1,1);layer.setMasterSource(master,{x:1,y:1,w:2,h:2});
    const original=layer.getImageData().data.slice(),marquee=Object.create(MarqueeTool.prototype);
    Object.assign(marquee,{bus,layerManager:manager,history,selection:{x:1,y:1,width:2,height:2},withSelection:(ctx,draw)=>draw(),startAntsAnimation(){},stopAntsAnimation(){},updatePreview(){}});
    marquee.liftSelectionToFloating(layer);marquee.selection={x:6,y:2,width:2,height:2};
    const tools=Object.create(ToolManager.prototype);Object.assign(tools,{bus,layerManager:manager,tools:{marquee},pointerSession:null});
    scope(t,'window',{mollyEditor:{tools}});
    const panel=Object.create(LayerPanel.prototype);Object.assign(panel,{bus,layerManager:manager,history});
    return {bus,manager,history,bottom,layer,marquee,panel,original,master};
}

test('duplicating a layer commits its floating pixels first and undo restores the original master',t=>{
    const {panel,layer,manager,marquee,history,original,master}=scene(t);
    panel.duplicateLayer(layer);
    const copy=manager.getActiveLayer();
    assert.equal(marquee.hasFloating(),false);assert.equal(history.undoStack.length,2);
    assert.deepEqual(copy.canvas.data,layer.canvas.data);assert.equal(layer.canvas.data[(2*12+6)*4+3],255);
    assert.equal(copy.sourceCanvas,master);
    history.undo();assert.equal(manager.layers.includes(copy),false);
    history.undo();assert.deepEqual(layer.canvas.data,original);assert.equal(layer.sourceCanvas,master);
    history.redo();history.redo();assert.deepEqual(copy.canvas.data,layer.canvas.data);
});

test('deleting a floating object records its committed placement before removing the layer',t=>{
    const {panel,layer,manager,marquee,history,original}=scene(t);
    panel.deleteLayer(layer);
    assert.equal(manager.layers.includes(layer),false);assert.equal(marquee.hasFloating(),false);
    history.undo();assert.equal(manager.layers.includes(layer),true);assert.equal(layer.canvas.data[(2*12+6)*4+3],255);
    history.undo();assert.deepEqual(layer.canvas.data,original);
});

for(const operation of ['mergeDownActive','flattenImage'])test(`${operation} includes floating pixels and can undo both operations independently`,t=>{
    const {panel,layer,manager,marquee,history,original}=scene(t);
    panel[operation]();
    assert.equal(marquee.hasFloating(),false);assert.equal(history.undoStack.length,2);
    assert.equal(manager.getActiveLayer().canvas.data[(2*12+6)*4+3],255);
    history.undo();assert.equal(manager.layers.includes(layer),true);assert.equal(layer.canvas.data[(2*12+6)*4+3],255);
    history.undo();assert.deepEqual(layer.canvas.data,original);
});

test('a failed floating commit restores the cut preview and permits a successful retry',t=>{
    const {marquee,layer,history,master,original}=scene(t),preview=layer.getImageData(),revision=layer.contentRevision;
    const draw=layer.ctx.drawImage.bind(layer.ctx);let fail=true;
    layer.ctx.drawImage=(...args)=>{draw(...args);if(fail)throw Error('Raster unavailable');};
    assert.equal(marquee.commitFloating(layer),false);
    assert.deepEqual(layer.canvas.data,preview.data);assert.equal(layer.contentRevision,revision);
    assert.equal(layer.ctx.stack.length,0);assert.equal(marquee.hasFloating(),true);assert.equal(marquee.floatingMaster,master);
    assert.equal(history.undoStack.length,0);
    fail=false;assert.equal(marquee.commitFloating(layer),true);assert.equal(history.undoStack.length,1);
    history.undo();assert.deepEqual(layer.canvas.data,original);assert.equal(layer.sourceCanvas,master);
});

test('pasting onto the base commits an older floating object instead of leaving it stranded',t=>{
    const {marquee,layer,bottom,manager,history,original}=scene(t);
    bottom.isBase=true;manager.setActive(bottom.id);
    const clipboard=new RasterCanvas(1,1);clipboard.context.fillStyle='#00ff00';clipboard.context.fillRect(0,0,1,1);
    marquee.clipboard={canvas:clipboard,master:clipboard,width:1,height:1};
    marquee.paste();
    assert.equal(marquee.hasFloating(),false);assert.equal(manager.layers.length,3);assert.equal(history.undoStack.length,2);
    assert.equal(layer.canvas.data[(2*12+6)*4+3],255);
    const pasted=manager.getActiveLayer();assert.equal(pasted.sourceCanvas,clipboard);
    history.undo();assert.equal(manager.layers.includes(pasted),false);
    history.undo();assert.deepEqual(layer.canvas.data,original);
});

test('layer actions leave data and history untouched when the pending editor input cannot commit',t=>{
    const {panel,layer,manager,history,marquee}=scene(t),layers=[...manager.layers],preview=layer.canvas.data.slice();
    window.mollyEditor.tools.finishDocument=()=>false;
    panel.addLayer();panel.duplicateLayer(layer);panel.deleteLayer(layer);panel.mergeDownActive();panel.flattenImage();
    assert.deepEqual(manager.layers,layers);assert.deepEqual(layer.canvas.data,preview);
    assert.equal(history.undoStack.length,0);assert.equal(marquee.hasFloating(),true);
});

test('Alt handle resizing uses symmetric rounding after Ctrl snapping and across repeated drags',()=>{
    const move=Object.create(MoveTool.prototype),original={x:4,y:5,w:7,h:5};
    Object.assign(move,{isLockAspect:()=>false,activeSourceCanvas:{width:8,height:8},updateDimensionBadge(){}});
    let box={...original};
    for(let index=0;index<10;index++){
        move.boxStart=box;move.currentBox={...box};move.scaleBoxFromHandle('se',-1,-1,true,true,{ctrlKey:true});
        assert.equal(move.currentBox.w,4);assert.equal(move.currentBox.h,4);
        move.boxStart={...move.currentBox};move.currentBox={...move.boxStart};move.scaleBoxFromHandle('se',1.5,.5,true,true,{});
        box={...move.currentBox};assert.deepEqual(box,original);
    }
    const marquee=Object.create(MarqueeTool.prototype);Object.assign(marquee,{hasFloating:()=>false,updatePreview(){}});
    const selection={x:4,y:5,width:7,height:5};let next={...selection};
    for(let index=0;index<10;index++){
        marquee.boxStart=next;marquee.scaleSelectionFromHandle('se',-1.5,-.5,false,true);
        assert.equal(marquee.selection.width,4);assert.equal(marquee.selection.height,4);
        marquee.boxStart={...marquee.selection};marquee.scaleSelectionFromHandle('se',1.5,.5,false,true);
        next={...marquee.selection};assert.deepEqual(next,selection);
    }
});

test('selection handle limits and reflection preserve the opposite edge',()=>{
    const tool=Object.create(MarqueeTool.prototype);
    Object.assign(tool,{boxStart:{x:10,y:20,width:7,height:5},hasFloating:()=>false,updatePreview(){}});
    tool.scaleSelectionFromHandle('nw',-10000,-10000,false,false);
    assert.deepEqual(tool.selection,{x:17-4096,y:25-4096,width:4096,height:4096});
    tool.scaleSelectionFromHandle('nw',10000,10000,false,false);
    assert.deepEqual(tool.selection,{x:17,y:25,width:4096,height:4096});
    tool.scaleSelectionFromHandle('nw',8,6,false,false);
    assert.deepEqual(tool.selection,{x:17,y:25,width:1,height:1});
});
