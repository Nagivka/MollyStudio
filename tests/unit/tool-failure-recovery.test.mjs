import test from 'node:test';
import assert from 'node:assert/strict';
import EventBus from '../../src/renderer/js/core/EventBus.js';
import History from '../../src/renderer/js/core/History.js';
import App from '../../src/renderer/js/core/App.js';
import ProjectManager from '../../src/renderer/js/core/ProjectManager.mjs';
import LayerManager from '../../src/renderer/js/graphics/LayerManager.js';
import ToolManager from '../../src/renderer/js/tools/ToolManager.js';
import BrushTool from '../../src/renderer/js/tools/BrushTool.js';
import PencilTool from '../../src/renderer/js/tools/PencilTool.js';
import EraserTool from '../../src/renderer/js/tools/EraserTool.js';
import BucketTool from '../../src/renderer/js/tools/BucketTool.js';
import GradientTool from '../../src/renderer/js/tools/GradientTool.js';
import LineTool from '../../src/renderer/js/tools/LineTool.js';
import RectTool from '../../src/renderer/js/tools/RectTool.js';
import CircleTool from '../../src/renderer/js/tools/CircleTool.js';
import {wrapLine} from '../../src/renderer/js/tools/ToolGeometry.js';
import {RasterCanvas} from '../helpers/raster-canvas.mjs';

function scope(t,key,value){const previous=globalThis[key];globalThis[key]=value;t.after(()=>{globalThis[key]=previous;});}
function fixture(t,Type,...args){
    scope(t,'document',{getElementById:()=>null,createElement:()=>new RasterCanvas()});
    scope(t,'window',{mollyEditor:{showToast(){},workspace:{tilingMode:false},settingsManager:{get:()=>true}}});
    const error=console.error;console.error=()=>{};t.after(()=>{console.error=error;});
    const bus=new EventBus(),layers=new LayerManager(bus,{width:16,height:16}),history=new History(bus),layer=layers.addLayer('Original');
    layer.ctx.fillStyle='#001122';layer.ctx.fillRect(0,0,16,16);layer.setMasterSource(layer.cloneCanvas(),{x:0,y:0,w:16,h:16});
    const tool=new Type(bus,layers,history,...args),manager=Object.create(ToolManager.prototype);
    Object.assign(manager,{bus,layerManager:layers,tools:{test:tool},currentToolId:'test',color:'#ff0000',size:1,pointerSession:null});
    tool.toolManager=manager;
    return {bus,layers,history,layer,tool,manager,before:layer.getImageData()};
}
function unchanged(layer,before){
    assert.deepEqual(layer.canvas.data,before.data);assert.equal(layer.sourceCanvas,before.mollySnapshot.sourceCanvas);
    assert.equal(layer.contentRevision,before.mollySnapshot.contentRevision);assert.equal(layer.ctx.stack?.length||0,0);
}

test('brush failure on initial stamp restores pixels, canvas state and pristine master',t=>{
    const {layer,manager,history,before}=fixture(t,BrushTool),fill=layer.ctx.fillRect.bind(layer.ctx);let fail=true;
    layer.ctx.fillRect=(...args)=>{fill(...args);if(fail)throw Error('Stamp failure');};
    assert.equal(manager.onPointerDown(2,2,{}),false);assert.equal(manager.pointerSession,null);unchanged(layer,before);assert.equal(history.undoStack.length,0);
    fail=false;manager.onPointerDown(2,2,{});manager.onPointerUp(3,2,{});
    assert.equal(history.undoStack.length,1);assert.equal(layer.canvas.data[(2*16+2)*4],255);
});

test('brush movement failure cancels the whole gesture and permits the next stroke',t=>{
    const {layer,manager,tool,history,before}=fixture(t,BrushTool),draw=tool.drawLine;
    manager.onPointerDown(2,2,{});tool.drawLine=function(ctx){ctx.fillRect(3,2,1,1);throw Error('Move failure');};
    assert.equal(manager.onPointerMove(4,2,{}),false);assert.equal(manager.pointerSession,null);unchanged(layer,before);
    manager.onPointerUp(4,2,{});assert.equal(history.undoStack.length,0);
    tool.drawLine=draw;manager.onPointerDown(4,4,{});manager.onPointerUp(5,4,{});assert.equal(history.undoStack.length,1);
});

test('pixel-perfect pencil failure restores its saved pixels and balances canvas state',t=>{
    const {layer,manager,tool,history,before}=fixture(t,PencilTool);
    manager.onPointerDown(2,2,{});tool.drawSymmetricStamp=(ctx,x,y)=>{ctx.fillRect(x,y,1,1);throw Error('Pencil failure');};
    assert.equal(manager.onPointerMove(3,2,{}),false);unchanged(layer,before);assert.equal(history.undoStack.length,0);
});

test('a partially written bucket result is rolled back when the canvas write fails',t=>{
    const {layer,manager,history,before}=fixture(t,BucketTool),put=layer.ctx.putImageData.bind(layer.ctx);let fail=true;
    layer.ctx.putImageData=(...args)=>{put(...args);if(fail){fail=false;throw Error('Bucket write failed');}};
    assert.equal(manager.onPointerDown(2,2,{}),false);unchanged(layer,before);assert.equal(history.undoStack.length,0);
    manager.onPointerDown(2,2,{});manager.onPointerUp(2,2,{});assert.equal(history.undoStack.length,1);
});

for(const [label,Type,draw] of [['line',LineTool,'drawLine'],['rectangle',RectTool,'drawRect'],['ellipse',CircleTool,'drawEllipse']]){
    test(`failed ${label} creation removes its provisional layer and retains the previous selection`,t=>{
        const {layers,manager,tool,layer,history,before}=fixture(t,Type,true);
        tool[draw]=(ctx)=>{ctx.fillStyle='#ff0000';ctx.fillRect(2,2,2,2);throw Error('Shape failed');};
        manager.onPointerDown(2,2,{});assert.equal(manager.onPointerUp(5,5,{}),false);
        assert.deepEqual(layers.layers,[layer]);assert.equal(layers.activeLayerId,layer.id);assert.equal(history.undoStack.length,0);unchanged(layer,before);
    });
    test(`successful ${label} creation is undoable and has no extra empty layer`,t=>{
        const {layers,manager,layer,history}=fixture(t,Type,true);
        manager.onPointerDown(2,2,{});assert.equal(manager.onPointerUp(5,5,{}),true);
        assert.equal(layers.layers.length,2);assert.equal(history.undoStack.length,1);const object=layers.getActiveLayer();assert.ok(object.getBounds());
        history.undo();assert.deepEqual(layers.layers,[layer]);history.redo();assert.equal(layers.getActiveLayer(),object);
    });
}

test('a shape drawn completely outside the document does not leave an empty object or history entry',t=>{
    const {layers,manager,layer,history}=fixture(t,RectTool,true);
    manager.onPointerDown(100,100,{});manager.onPointerUp(104,104,{});
    assert.deepEqual(layers.layers,[layer]);assert.equal(layers.activeLayerId,layer.id);assert.equal(history.undoStack.length,0);
});

test('returning a live gradient to its origin invalidates the effect cache after restoring the snapshot',t=>{
    const {layer,manager,tool,before}=fixture(t,GradientTool);tool.drawVectorLine=()=>{};
    tool.renderGradient=ctx=>{ctx.fillStyle='#ff0000';ctx.fillRect(0,0,16,16);};
    layer.setFX({texture:{type:'grain',amount:50,seed:2}});const original=layer.getRenderCanvas().data.slice();
    manager.onPointerDown(2,2,{});manager.onPointerMove(8,2,{});const painted=layer.getRenderCanvas().data.slice();assert.notDeepEqual(painted,original);
    manager.onPointerMove(2,2,{});assert.deepEqual(layer.canvas.data,before.data);assert.equal(layer.fxDirty,true);
    assert.deepEqual(layer.getRenderCanvas().data,original);manager.cancelPointer();
});

test('gradient failures restore both raster pixels and drawing context state',t=>{
    const {layer,manager,tool,history,before}=fixture(t,GradientTool);
    tool.renderGradient=ctx=>{ctx.fillStyle='#ff0000';ctx.fillRect(0,0,16,16);throw Error('Gradient failed');};
    manager.onPointerDown(2,2,{});assert.equal(manager.onPointerMove(8,2,{}),false);unchanged(layer,before);assert.equal(history.undoStack.length,0);
    assert.equal(tool.applyToActiveLayer(),false);unchanged(layer,before);
});

test('shape property redraw failure restores geometry, pixels, master and revision',t=>{
    const {layer,bus,layers,history}=fixture(t,RectTool,true),app=Object.create(App.prototype);
    layer.shapeData={type:'rect-filled',x0:2,y0:2,x1:5,y1:5,color:'#001122',filled:true,stroke:1,radius:0};layer.objectType='rect-filled';
    const before=layer.getImageData();
    Object.assign(app,{bus,layerManager:layers,history,showToast(){},redrawShapeLayer(target){target.clear();throw Error('Shape redraw failed');}});
    assert.equal(app.editShapeLayer(layer,{radius:2}),false);unchanged(layer,before);
    assert.deepEqual(layer.shapeData,before.mollySnapshot.shapeData);assert.equal(history.undoStack.length,0);
});

test('wrapped brush, eraser and pencil do bounded work for a pointer many tiles outside the image',t=>{
    const {tool:brush}=fixture(t,BrushTool);window.mollyEditor.workspace.tilingMode=true;
    const stamps=[];brush.drawStamp=(ctx,x,y)=>{stamps.push([x,y]);assert.ok(stamps.length<=33);};
    brush.drawLine({},2,2,1e9+3,-1e9+4,'#ff0000',1,16,16);assert.ok(stamps.length<=16);
    const eraser=Object.create(EraserTool.prototype);let erased=0;eraser.eraseStamp=()=>{assert.ok(++erased<=16);};
    eraser.eraseLine({},2,2,1e9+3,-1e9+4,1,16,16);
    const pencil=new PencilTool(brush.bus,brush.layerManager,brush.history),layer=brush.layerManager.getActiveLayer();
    Object.assign(pencil,{targetLayer:layer,isDrawing:true,lastX:2,lastY:2,pixelPerfectPoints:[]});let drawn=0;
    pencil.drawSymmetricStamp=()=>{assert.ok(++drawn<=16);};pencil.onPointerMove(1e9+3,-1e9+4,'#ff0000',1,layer);
    assert.ok(drawn>0);assert.equal(pencil.lastX,1e9+3);
    assert.deepEqual(wrapLine(1e9+2,-1e9+2,1e9+3,-1e9+4,16,16),{x0:2,y0:2,x1:3,y1:4});
});

function documentState(t,fixture){
    const {layer,layers,manager,bus}=fixture,project={id:'p',name:'P',type:'canvas',layers:[layer],config:{width:16,height:16}};
    window.addEventListener=()=>{};
    const app={projects:[project],activeProjectId:'p',config:project.config,layerManager:layers,tools:manager,bus};
    const storage=new ProjectManager(app);storage.initAutosave();storage.markClean('p');storage.markSaved('p');
    t.after(()=>storage.releaseProject('p'));return storage;
}

test('failed shape creation never marks a saved document changed by its temporary layer',t=>{
    const state=fixture(t,RectTool,true),storage=documentState(t,state);
    state.tool.drawRect=()=>{throw Error('Shape failed');};state.manager.onPointerDown(2,2,{});state.manager.onPointerUp(5,5,{});
    assert.equal(storage.hasUnsavedChanges('p'),false);assert.equal(storage.autosaveDirtyIds.size,0);assert.equal(state.manager.settlingGesture,undefined);
});

test('a no-op stroke ending at a new pointer position preserves the saved revision and pristine source',t=>{
    const state=fixture(t,BrushTool),storage=documentState(t,state);state.manager.color='#001122';
    state.manager.onPointerDown(2,2,{});state.manager.onPointerUp(5,2,{});
    unchanged(state.layer,state.before);assert.equal(state.history.undoStack.length,0);
    assert.equal(storage.hasUnsavedChanges('p'),false);assert.equal(storage.autosaveDirtyIds.size,0);
});

test('a successful stroke becomes dirty only after the final history action is installed',t=>{
    const state=fixture(t,BrushTool),storage=documentState(t,state),observed=[];
    state.bus.on('DOCUMENT_STATUS_CHANGED',()=>observed.push({history:state.history.undoStack.length,settling:Boolean(state.manager.settlingGesture)}));
    state.manager.onPointerDown(2,2,{});assert.equal(storage.hasUnsavedChanges('p'),false);
    state.manager.onPointerUp(5,2,{});assert.equal(storage.hasUnsavedChanges('p'),true);
    assert.deepEqual(observed,[{history:1,settling:false}]);
});
