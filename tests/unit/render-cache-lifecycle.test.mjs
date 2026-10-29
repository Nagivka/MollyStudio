import test from 'node:test';
import assert from 'node:assert/strict';
import EventBus from '../../src/renderer/js/core/EventBus.js';
import History from '../../src/renderer/js/core/History.js';
import {AddLayerCommand,RemoveLayerCommand,FlattenLayersCommand,CompoundCommand} from '../../src/renderer/js/core/Commands.js';
import {releaseLayerCaches,releaseProjectRenderCaches} from '../../src/renderer/js/core/RenderCache.mjs';
import Layer from '../../src/renderer/js/graphics/Layer.js';
import LayerManager from '../../src/renderer/js/graphics/LayerManager.js';
import {drawLayers} from '../../src/renderer/js/graphics/LayerCompositing.js';
import App from '../../src/renderer/js/core/App.js';
import {RasterCanvas} from '../helpers/raster-canvas.mjs';

function scope(t,key,value){const saved=globalThis[key];globalThis[key]=value;t.after(()=>{globalThis[key]=saved;});}
function canvases(t){
    const created=[];scope(t,'document',{getElementById:()=>null,createElement(){const canvas=new RasterCanvas();created.push(canvas);return canvas;}});
    scope(t,'window',{});return created;
}
function textured(layer){
    layer.ctx.fillStyle='#ff4400';layer.ctx.fillRect(2,2,4,3);
    layer.setMasterSource(layer.cloneCanvas(),{x:0,y:0,w:layer.width,h:layer.height});
    layer.setFX({outline:{enabled:true,color:'#334455'},shadow:{enabled:true,offsetX:1,offsetY:1,color:'#112233'},texture:{type:'grain',seed:22,amount:50}});
    const rendered=layer.getRenderCanvas().data.slice();
    return {rendered,buffers:[layer.fxCanvas,...Object.values(layer.fxScratch)],master:layer.sourceCanvas,revision:layer.contentRevision,pixels:layer.canvas.data.slice()};
}
function released(buffers){for(const canvas of buffers){assert.equal(canvas.width,1);assert.equal(canvas.height,1);}}

test('releasing derived effects preserves pixels, master, settings, revision and exact rebuilt output',t=>{
    canvases(t);const layer=new Layer('a','',12,8),state=textured(layer),fx=structuredClone(layer.fx);
    layer.releaseRenderCache();released(state.buffers);
    assert.deepEqual(layer.canvas.data,state.pixels);assert.equal(layer.sourceCanvas,state.master);
    assert.equal(state.master.width,12);assert.equal(state.master.height,8);assert.equal(layer.contentRevision,state.revision);
    assert.deepEqual(layer.fx,fx);assert.equal(layer.fxCanvas,null);assert.equal(Object.keys(layer.fxScratch).length,0);
    assert.deepEqual(layer.getRenderCanvas().data,state.rendered);
});

test('layer removal and repeated undo/redo free only derived buffers and retain full editability',t=>{
    canvases(t);const bus=new EventBus(),manager=new LayerManager(bus,{width:12,height:8}),history=new History(bus);
    const layer=manager.addLayer(),state=textured(layer),command=new RemoveLayerCommand(manager,layer,0);
    manager.removeLayer(layer.id);history.push(command);released(state.buffers);
    history.undo();assert.equal(manager.layers[0],layer);assert.deepEqual(layer.getRenderCanvas().data,state.rendered);
    const rebuilt=[layer.fxCanvas,...Object.values(layer.fxScratch)];history.redo();released(rebuilt);
    history.undo();assert.deepEqual(layer.getRenderCanvas().data,state.rendered);assert.equal(layer.sourceCanvas,state.master);
    assert.deepEqual(layer.canvas.data,state.pixels);
});

test('undoing an added layer releases effects while redo still restores the original object',t=>{
    canvases(t);const manager=new LayerManager(new EventBus(),{width:12,height:8}),layer=manager.addLayer(),state=textured(layer);
    const command=new AddLayerCommand(manager,layer);command.undo();released(state.buffers);
    command.execute();assert.equal(manager.layers[0],layer);assert.equal(layer.sourceCanvas,state.master);
    assert.deepEqual(layer.getRenderCanvas().data,state.rendered);
});

test('removing a group frees its composition cache and undo rebuilds the same pixels',t=>{
    const created=canvases(t),manager=new LayerManager(new EventBus(),{width:12,height:8});
    const group=manager.addGroup(),layer=manager.addLayer();layer.groupId=group.id;group.opacity=.5;
    layer.ctx.fillStyle='#00ff00';layer.ctx.fillRect(1,1,4,3);layer.invalidateSource();
    const output=new RasterCanvas(12,8);drawLayers(output.context,manager.layers);const expected=output.data.slice(),cached=created.at(-1);
    const command=new RemoveLayerCommand(manager,group,manager.layers.indexOf(group));manager.removeLayer(group.id);released([cached]);
    command.undo();output.context.clearRect(0,0,12,8);drawLayers(output.context,manager.layers);
    assert.deepEqual(output.data,expected);assert.equal(layer.groupId,group.id);assert.notEqual(created.at(-1),cached);
});

test('flattening releases detached caches and can restore both the pixels and editable effects',t=>{
    canvases(t);const bus=new EventBus(),manager=new LayerManager(bus,{width:12,height:8});
    const lower=manager.addLayer(),upper=manager.addLayer(),state=textured(lower);upper.ctx.fillStyle='#00ff00';upper.ctx.fillRect(10,0,1,1);upper.invalidateSource();
    const {oldLayers,newLayers}=manager.flattenImage(),flattened=newLayers[0].canvas.data.slice();released(state.buffers);
    const command=new FlattenLayersCommand(manager,oldLayers,newLayers);command.undo();
    assert.deepEqual(lower.getRenderCanvas().data,state.rendered);assert.equal(lower.sourceCanvas,state.master);
    const rebuilt=[lower.fxCanvas,...Object.values(lower.fxScratch)];command.execute();released(rebuilt);
    assert.deepEqual(manager.getActiveLayer().canvas.data,flattened);
});

test('project cleanup visits nested history and detached layers once without touching other documents',t=>{
    canvases(t);const current=new Layer('current','',12,8),removed=new Layer('removed','',12,8),group=new Layer('group','',12,8,'group'),other=new Layer('other','',12,8);
    const currentState=textured(current),removedState=textured(removed),otherState=textured(other);
    const counts=new Map();for(const layer of [current,removed,group]){const release=layer.releaseRenderCache.bind(layer);layer.releaseRenderCache=()=>{counts.set(layer,(counts.get(layer)||0)+1);release();};}
    const command=new CompoundCommand([{layer:removed},{oldLayersOrder:[current,removed,group],newLayersOrder:[current,group],childLayers:[current],group}]);
    releaseProjectRenderCaches({layers:[current],undoStack:[command],redoStack:[command]});
    released([...currentState.buffers,...removedState.buffers]);assert.deepEqual([...counts.values()],[1,1,1]);
    assert.equal(other.fxCanvas.width,12);assert.deepEqual(other.getRenderCanvas().data,otherState.rendered);
    assert.equal(removed.sourceCanvas,removedState.master);assert.deepEqual(removed.canvas.data,removedState.pixels);
    releaseLayerCaches([other,current],[other]);assert.equal(other.fxCanvas.width,12);
});

test('successful tab close releases current and historical caches while a refused close keeps them',async t=>{
    canvases(t);scope(t,'requestAnimationFrame',callback=>callback());
    const current=new Layer('current','',12,8),removed=new Layer('removed','',12,8),otherLayer=new Layer('other','',12,8);
    const currentState=textured(current),removedState=textured(removed);textured(otherLayer);
    const project={id:'p',name:'P',layers:[current],undoStack:[{layer:removed}]},other={id:'other',layers:[otherLayer]},app=Object.create(App.prototype);
    let allow=false;Object.assign(app,{projects:[project,other],activeProjectId:'p',tools:{finishDocument:()=>true},settingsManager:{get:()=>false},showToast(){},updateDiscordPresence(){},loadProjectState(id){this.activeProjectId=id;},projectManager:{waitForPendingSaves:async()=>{},flushProject:async()=>allow,releaseProject(){}}});
    assert.equal(await app.closeProject('p'),false);assert.equal(current.fxCanvas.width,12);assert.equal(removed.fxCanvas.width,12);
    allow=true;assert.equal(await app.closeProject('p'),true);released([...currentState.buffers,...removedState.buffers]);
    assert.equal(otherLayer.fxCanvas.width,12);assert.equal(current.sourceCanvas,currentState.master);assert.deepEqual(app.projects,[other]);
});
