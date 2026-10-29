import test from 'node:test';
import assert from 'node:assert/strict';
import History from '../../src/renderer/js/core/History.js';
import EventBus from '../../src/renderer/js/core/EventBus.js';
import {CompoundCommand} from '../../src/renderer/js/core/Commands.js';
import ProjectManager from '../../src/renderer/js/core/ProjectManager.mjs';
import MarqueeTool from '../../src/renderer/js/tools/MarqueeTool.js';
import Layer from '../../src/renderer/js/graphics/Layer.js';
import {RasterCanvas} from '../helpers/raster-canvas.mjs';

function scoped(t,key,value){const old=globalThis[key];globalThis[key]=value;t.after(()=>{globalThis[key]=old;});}
function makeCommand(state,value){const before=state.value;return {name:'Edit',undo(){state.value=before;},execute(){state.value=value;}};}

test('undo cancels a live gesture without also undoing the previous completed edit',t=>{
    let pending=true;const state={value:0},history=new History(new EventBus()),edit=makeCommand(state,1);
    edit.execute();history.push(edit);state.value=2;
    scoped(t,'window',{mollyEditor:{tools:{tools:{},cancelPointer(){if(!pending)return false;pending=false;state.value=1;return true;}}}});
    assert.equal(history.undo(),true);assert.equal(state.value,1);
    assert.equal(history.undoStack.length,1);assert.equal(history.redoStack.length,0);
    assert.equal(history.undo(),true);assert.equal(state.value,0);
});

test('redo and history navigation cancel floating edits without skipping the requested state',t=>{
    const state={value:0},history=new History(new EventBus());let floating=false;
    scoped(t,'window',{mollyEditor:{tools:{cancelPointer:()=>false,tools:{marquee:{hasFloating:()=>floating,cancelFloating(){floating=false;}}}}}});
    const first=makeCommand(state,1);first.execute();history.push(first);
    const second=makeCommand(state,2);second.execute();history.push(second);
    history.undo();floating=true;
    assert.equal(history.redo(),true);assert.equal(state.value,1);assert.equal(history.redoStack.length,1);
    floating=true;history.jumpTo(0);assert.equal(state.value,0);assert.equal(history.undoStack.length,0);
    history.jumpTo(2);assert.equal(state.value,2);
});

test('a compound edit rolls back the command that partially applied before throwing',()=>{
    const state={value:0},first=makeCommand(state,1),second={execute(){state.value=2;throw Error('apply failed');},undo(){state.value=1;}};
    assert.throws(()=>new CompoundCommand([first,second]).execute(),/apply failed/);
    assert.equal(state.value,0);
});

test('a compound undo recovers its original state when an undo partially applies then throws',()=>{
    const state={value:2};
    const first={undo(){state.value=0;throw Error('undo failed');},execute(){state.value=1;}};
    const second={undo(){state.value=1;},execute(){state.value=2;}};
    assert.throws(()=>new CompoundCommand([first,second]).undo(),/undo failed/);
    assert.equal(state.value,2);
});

test('floating cut previews and their cancellation never mark a saved document modified',t=>{
    scoped(t,'document',{createElement:()=>new RasterCanvas()});scoped(t,'window',{addEventListener(){}});
    const layer=new Layer('a','',8,8);layer.ctx.fillStyle='#ff0000';layer.ctx.fillRect(1,1,2,2);layer.invalidateSource();
    const bus=new EventBus(),marquee=Object.create(MarqueeTool.prototype),project={id:'p',layers:[layer],config:{width:8,height:8}};
    Object.assign(marquee,{selection:{x:1,y:1,width:2,height:2},floatingLayer:null,layerManager:{getActiveLayer:()=>layer},bus,stopAntsAnimation(){}});
    const app={projects:[project],activeProjectId:'p',config:project.config,layerManager:{getLayers:()=>[layer]},tools:{tools:{marquee}},bus};
    const manager=new ProjectManager(app);manager.initAutosave();manager.markClean('p');manager.markSaved('p');
    const before=layer.getImageData();
    marquee.beforeData=before;marquee.floatingLayer=layer;marquee.floatingCanvas=new RasterCanvas(2,2);
    layer.clear();bus.emit('CANVAS_UPDATED');
    assert.equal(manager.hasUnsavedChanges('p'),false);assert.equal(manager.autosaveDirtyIds.size,0);
    marquee.cancelFloating();
    assert.equal(manager.hasUnsavedChanges('p'),false);assert.equal(manager.autosaveDirtyIds.size,0);
    assert.deepEqual(layer.getImageData().data,before.data);
});
