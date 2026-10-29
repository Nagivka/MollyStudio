import test from 'node:test';
import assert from 'node:assert/strict';
import EventBus from '../../src/renderer/js/core/EventBus.js';
import History from '../../src/renderer/js/core/History.js';
import LayerManager from '../../src/renderer/js/graphics/LayerManager.js';
import MarqueeTool from '../../src/renderer/js/tools/MarqueeTool.js';
import {combineSelection,containsPixel} from '../../src/renderer/js/tools/SelectionGeometry.mjs';
import {RasterCanvas} from '../helpers/raster-canvas.mjs';

function scene(t) {
    const previous={document:globalThis.document,window:globalThis.window},canvases=[];
    globalThis.document={getElementById:()=>null,createElement(){const canvas=new RasterCanvas();canvases.push(canvas);return canvas;}};
    globalThis.window={mollyEditor:{showToast(){}}};
    const error=console.error;console.error=()=>{};
    t.after(()=>{Object.assign(globalThis,previous);console.error=error;});
    const bus=new EventBus(),layers=new LayerManager(bus,{width:12,height:8}),history=new History(bus),layer=layers.addLayer('Pixels');
    layer.ctx.fillStyle='#225588';layer.ctx.fillRect(1,1,8,5);layer.setMasterSource(layer.cloneCanvas(),{x:0,y:0,w:12,h:8});
    const tool=Object.assign(Object.create(MarqueeTool.prototype),{bus,layerManager:layers,history,selection:{x:2,y:2,width:4,height:3},startAntsAnimation(){},stopAntsAnimation(){},updatePreview(){}});
    tool.toolManager={tools:{marquee:tool}};
    return {tool,layer,layers,history,canvases};
}

for(const operation of ['fillSelection','strokeSelection','recolorSelection','deleteSelection','cut','invertSelectedColors']) {
    test(`failed ${operation} restores pixels, master and revision without adding history`,t=>{
        const {tool,layer,history}=scene(t),before=layer.getImageData(),selection=structuredClone(tool.selection);
        const get=layer.getImageData.bind(layer);let reads=0;
        layer.getImageData=()=>{if(++reads===2)throw Error('Readback failed');return get();};
        assert.doesNotThrow(()=>tool[operation]('#ee1122'));
        assert.deepEqual(layer.canvas.data,before.data);assert.equal(layer.contentRevision,before.mollySnapshot.contentRevision);
        assert.equal(layer.sourceCanvas,before.mollySnapshot.sourceCanvas);assert.deepEqual(tool.selection,selection);
        assert.equal(layer.ctx.stack?.length||0,0);assert.equal(history.undoStack.length,0);
    });
}

for(const operation of ['fillSelection','strokeSelection','recolorSelection','invertSelectedColors']) {
    test(`failed floating ${operation} leaves its original pixels and immutable master usable`,t=>{
        const {tool,layer,history,canvases}=scene(t);tool.liftSelectionToFloating(layer);
        const floating=tool.floatingCanvas,master=tool.floatingMaster,before=floating.data.slice(),cut=layer.canvas.data.slice();
        const create=document.createElement,patched=new WeakSet();let failed=false;
        const patch=canvas=>{const get=canvas.getContext.bind(canvas);canvas.getContext=(...args)=>{
            const ctx=get(...args);if(patched.has(ctx))return ctx;patched.add(ctx);let writes=0;
            for(const name of ['fillRect','putImageData']){const draw=ctx[name].bind(ctx);ctx[name]=(...args)=>{draw(...args);
                if(name==='putImageData')writes++;
                if(!failed&&(name==='fillRect'||canvas===floating||writes>1)){failed=true;throw Error('Floating write failed');}
            };}
            return ctx;
        };
        };
        patch(floating);document.createElement=()=>{const canvas=create();patch(canvas);return canvas;};
        const start=canvases.length;
        assert.doesNotThrow(()=>tool[operation]('#ee1122'));
        assert.equal(failed,true);
        assert.equal(tool.floatingCanvas,floating);assert.equal(tool.floatingMaster,master);assert.deepEqual(floating.data,before);
        assert.deepEqual(layer.canvas.data,cut);assert.equal(history.undoStack.length,0);
        assert.equal(floating.context.stack?.length||0,0);
        assert.ok(canvases.slice(start).every(canvas=>canvas.width===1&&canvas.height===1));
    });
}

test('failed paste onto a base removes the provisional layer and keeps the clipboard for retry',t=>{
    const {tool,layer,layers,history}=scene(t);layer.isBase=true;
    const clipboard=new RasterCanvas(2,2);clipboard.context.fillStyle='#00ff00';clipboard.context.fillRect(0,0,2,2);
    tool.clipboard={canvas:clipboard,master:clipboard,width:2,height:2};
    const add=layers.addLayer.bind(layers);let fail=true;
    layers.addLayer=(...args)=>{const next=add(...args),draw=next.ctx.drawImage.bind(next.ctx);next.ctx.drawImage=(...args)=>{draw(...args);if(fail)throw Error('Paste failed');};return next;};
    assert.doesNotThrow(()=>tool.paste());assert.deepEqual(layers.layers,[layer]);assert.equal(layers.activeLayerId,layer.id);
    assert.equal(history.undoStack.length,0);assert.equal(tool.clipboard.canvas,clipboard);
    fail=false;tool.paste();assert.equal(layers.layers.length,2);assert.equal(history.undoStack.length,1);
    history.undo();assert.deepEqual(layers.layers,[layer]);
});

test('recoloring frees its temporary image while remaining undoable',t=>{
    const {tool,layer,history,canvases}=scene(t),before=layer.canvas.data.slice(),start=canvases.length;
    tool.recolorSelection('#ff0000');assert.equal(history.undoStack.length,1);
    assert.ok(canvases.slice(start).every(canvas=>canvas.width===1&&canvas.height===1));
    const after=layer.canvas.data.slice();history.undo();assert.deepEqual(layer.canvas.data,before);history.redo();assert.deepEqual(layer.canvas.data,after);
});

test('floating color edits preserve a copied master and become one undoable commit',t=>{
    const {tool,layer,history}=scene(t),before=layer.canvas.data.slice();
    tool.liftSelectionToFloating(layer);tool.copy();const copied=tool.clipboard.master,pixels=copied.data.slice();
    tool.fillSelection('#ff0000');assert.deepEqual(copied.data,pixels);assert.notEqual(tool.floatingMaster,copied);
    assert.equal(history.undoStack.length,0);assert.equal(tool.commitFloating(layer),true);assert.equal(history.undoStack.length,1);
    history.undo();assert.deepEqual(layer.canvas.data,before);
});

for(const operation of ['cut','deleteSelection'])test(`failed floating ${operation} does not discard a pending moved area`,t=>{
    const {tool,layer,history}=scene(t);tool.liftSelectionToFloating(layer);
    const canvas=tool.floatingCanvas,before=tool.beforeData,mask=tool.selection;
    layer.getImageData=()=>{throw Error('Readback unavailable');};
    assert.doesNotThrow(()=>tool[operation]());assert.equal(tool.hasFloating(),true);
    assert.equal(tool.floatingCanvas,canvas);assert.equal(tool.beforeData,before);assert.equal(tool.selection,mask);
    assert.equal(history.undoStack.length,0);
});

test('cut cannot erase pixels when copying its replacement clipboard fails',t=>{
    const {tool,layer,history,canvases}=scene(t),before=layer.canvas.data.slice(),clipboard={canvas:new RasterCanvas(1,1)};
    tool.clipboard=clipboard;const create=document.createElement;
    document.createElement=()=>{const canvas=create(),get=canvas.getContext.bind(canvas);canvas.getContext=(...args)=>{const ctx=get(...args);ctx.drawImage=()=>{throw Error('Copy unavailable');};return ctx;};return canvas;};
    const start=canvases.length;assert.doesNotThrow(()=>tool.cut());
    assert.deepEqual(layer.canvas.data,before);assert.equal(tool.clipboard,clipboard);assert.equal(history.undoStack.length,0);
    assert.ok(canvases.slice(start).every(canvas=>canvas.width===1&&canvas.height===1));
});

test('lifting pixels rolls back a partial clear and releases prepared floating buffers',t=>{
    const {tool,layer,history,canvases}=scene(t),before=layer.getImageData(),mask=tool.selection,start=canvases.length;
    const clear=layer.ctx.clearRect.bind(layer.ctx);layer.ctx.clearRect=(...args)=>{clear(...args);throw Error('Clear failed');};
    assert.doesNotThrow(()=>tool.liftSelectionToFloating(layer));
    assert.deepEqual(layer.canvas.data,before.data);assert.equal(layer.sourceCanvas,before.mollySnapshot.sourceCanvas);
    assert.equal(layer.contentRevision,before.mollySnapshot.contentRevision);assert.equal(tool.selection,mask);
    assert.equal(tool.hasFloating(),false);assert.equal(history.undoStack.length,0);assert.equal(layer.ctx.stack?.length||0,0);
    assert.ok(canvases.slice(start).every(canvas=>canvas.width===1&&canvas.height===1));
});

for(const operation of ['fillSelection','strokeSelection','recolorSelection','invertSelectedColors','deleteSelection','cut']) {
    test(`${operation} respects holes in a compound mask and restores the pristine master on undo`,t=>{
        const {tool,layer,history}=scene(t),before=layer.getImageData(),master=layer.sourceCanvas;
        const mask=combineSelection({x:1,y:1,width:8,height:5},{x:3,y:2,width:3,height:2},'subtract');
        tool.selection=mask;tool[operation]('#ff0000');const after=layer.canvas.data.slice();let changed=0;
        for(let y=0;y<8;y++)for(let x=0;x<12;x++){
            const offset=(y*12+x)*4,pixel=after.subarray(offset,offset+4),original=before.data.subarray(offset,offset+4);
            if(!containsPixel(mask,x,y))assert.deepEqual(pixel,original,`outside the mask at ${x},${y}`);
            else if(pixel.some((value,index)=>value!==original[index]))changed++;
        }
        assert.ok(changed>0);assert.equal(history.undoStack.length,1);assert.equal(layer.ctx.stack?.length||0,0);
        history.undo();assert.deepEqual(layer.canvas.data,before.data);assert.equal(layer.sourceCanvas,master);
        history.redo();assert.deepEqual(layer.canvas.data,after);
    });
}
