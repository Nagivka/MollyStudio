import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PNG} from 'pngjs';
import EventBus from '../../src/renderer/js/core/EventBus.js';
import History from '../../src/renderer/js/core/History.js';
import Layer from '../../src/renderer/js/graphics/Layer.js';
import LayerManager from '../../src/renderer/js/graphics/LayerManager.js';
import PrefixEditor from '../../src/renderer/js/ui/PrefixEditor.js';
import PrefixRenderer from '../../src/renderer/js/graphics/PrefixRenderer.js';
import DesignGallery from '../../src/renderer/js/ui/DesignGallery.js';
import PropertiesInspector from '../../src/renderer/js/ui/PropertiesInspector.js';
import TextTool from '../../src/renderer/js/tools/TextTool.js';
import CanvasTextEditor from '../../src/renderer/js/ui/CanvasTextEditor.js';
import MoveTool from '../../src/renderer/js/tools/MoveTool.js';
import {transformBatch} from '../../src/renderer/js/tools/BatchTransform.js';
import {normalizePrefixDocument} from '../../src/renderer/js/core/PrefixDocument.mjs';
import {RasterCanvas} from '../helpers/raster-canvas.mjs';

function scope(t,key,value){const old=globalThis[key];globalThis[key]=value;t.after(()=>{globalThis[key]=old;});}
function fixture(t){
    const canvases=[];
    scope(t,'document',{getElementById:()=>null,createElement(){
        const canvas=new RasterCanvas();canvases.push(canvas);const get=canvas.getContext.bind(canvas);
        canvas.getContext=()=>{const ctx=get();ctx.translate??=()=>{};ctx.rotate??=()=>{};ctx.scale??=()=>{};return ctx;};return canvas;
    }});scope(t,'window',{mollyEditor:{showToast(){}}});
    const bus=new EventBus(),layers=new LayerManager(bus,{width:16,height:16}),history=new History(bus);
    return {canvases,bus,layers,history};
}
async function renderer(){
    const renderer=new PrefixRenderer();
    for(const [id,file] of Object.entries({minecraft:'default.png',smallcaps:'smallcaps.png','minecraft-ten':'ten.png'}))renderer.images[id]=PNG.sync.read(await readFile(new URL(`../../src/renderer/assets/images/${file}`,import.meta.url)));
    return renderer;
}
function paintLayer(layers,name,x){
    const layer=layers.addLayer(name),master=new RasterCanvas(3,2);master.context.fillStyle='#ff5500';master.context.fillRect(0,0,3,2);
    layer.ctx.drawImage(master,x,2);layer.setMasterSource(master,{x,y:2,w:3,h:2});return layer;
}

test('prefix fallback glyph cache stays bounded while warnings retain every missing character',async t=>{
    const {canvases}=fixture(t),r=await renderer();
    for(let index=0;index<5000;index++)assert.equal(r.glyph(String.fromCodePoint(0x3400+index),'smallcaps').missing,true);
    assert.equal(r.glyphs.size,1);assert.equal(canvases.length,1);
    assert.equal(r.glyph('?','minecraft-ten').missing,false);assert.equal(r.glyphs.size,2);
    const mask=r.textMask({text:'🎃🎄',font:'smallcaps',letterSpacing:0});assert.deepEqual(mask.missing,['🎃','🎄']);
});

test('prefix rendering releases mask, tint and shadow buffers while retaining output and reusable caches',async t=>{
    const {canvases}=fixture(t),r=await renderer(),doc=normalizePrefixDocument({blocks:[{text:'VIP',shadow:true,textShadow:true}]});
    const result=r.render(doc),expected=result.canvas.data.slice();
    const retained=new Set([result.canvas,...[...r.glyphs.values()].map(g=>g.tile),...[...r.blockCache.values()].map(block=>block.canvas)]);
    const temporary=canvases.filter(canvas=>!retained.has(canvas));assert.ok(temporary.length>=3);
    assert.ok(temporary.every(canvas=>canvas.width===1&&canvas.height===1));assert.ok(result.canvas.width>1);
    const repeat=r.render(doc);assert.deepEqual(repeat.canvas.data,expected);assert.equal(r.blockCache.size,1);
});

test('failed prefix block rendering releases prepared buffers and never caches a partial result',async t=>{
    const {canvases}=fixture(t),r=await renderer(),create=document.createElement;
    document.createElement=()=>{const canvas=create(),get=canvas.getContext.bind(canvas);canvas.getContext=()=>{
        const ctx=get();if(canvas.width>8&&canvas.height>8)ctx.putImageData=()=>{throw Error('Prefix canvas failed');};return ctx;};return canvas;};
    assert.throws(()=>r.render(normalizePrefixDocument()),/Prefix canvas failed/);assert.equal(r.blockCache.size,0);
    const glyphs=new Set([...r.glyphs.values()].map(g=>g.tile));
    assert.ok(canvases.filter(canvas=>!glyphs.has(canvas)).every(canvas=>canvas.width===1&&canvas.height===1));
});

test('failed prefix application restores its previous raster, master, revision and model',t=>{
    const {bus,history}=fixture(t),layer=new Layer('prefix','Prefix',16,16);layer.objectType='prefix';layer.locked=true;
    layer.ctx.fillStyle='#336699';layer.ctx.fillRect(1,1,5,5);layer.setMasterSource(layer.cloneCanvas(),{x:0,y:0,w:16,h:16});
    const before=layer.getImageData(),data=normalizePrefixDocument(),project={id:'p',layers:[layer],config:{width:16,height:16},prefixData:data};
    const output=new RasterCanvas(16,16);output.context.fillStyle='#ff0000';output.context.fillRect(0,0,16,16);
    const editor=Object.create(PrefixEditor.prototype);Object.assign(editor,{project:()=>project,app:{bus,history},renderer:{render:()=>({canvas:output,data:{changed:true},missing:[]})}});
    const draw=layer.ctx.drawImage.bind(layer.ctx);layer.ctx.drawImage=(...args)=>{draw(...args);throw Error('Prefix application failed');};
    assert.throws(()=>editor.apply(project,{changed:true}),/Prefix application failed/);
    assert.deepEqual(layer.canvas.data,before.data);assert.equal(layer.sourceCanvas,before.mollySnapshot.sourceCanvas);assert.equal(layer.contentRevision,before.mollySnapshot.contentRevision);
    assert.equal(project.prefixData,data);assert.equal(project.layers[0],layer);assert.deepEqual(project.config,{width:16,height:16});assert.equal(output.width,1);
});

test('GUI design failure restores base pixels and original source without recording an action',t=>{
    const {bus,layers,history}=fixture(t),layer=paintLayer(layers,'Base',2);layer.isBase=true;
    const before=layer.getImageData(),project={id:'p'},status={textContent:''},gallery=new DesignGallery({bus,history,getActiveProject:()=>project,layerManager:layers});
    Object.assign(gallery,{project,prefix:false,selected:'slate',base:layer,baseRevision:layer.contentRevision,dialog:{querySelector:()=>status,close(){assert.fail('failed design must remain open');}},fullImage:()=>new RasterCanvas(16,16)});
    layer.ctx.drawImage=()=>{throw Error('Design draw failed');};gallery.apply();
    assert.match(status.textContent,/Design draw failed/);assert.deepEqual(layer.canvas.data,before.data);assert.equal(layer.sourceCanvas,before.mollySnapshot.sourceCanvas);
    assert.equal(layer.contentRevision,before.mollySnapshot.contentRevision);assert.equal(history.undoStack.length,0);
});

test('text creation failure removes the provisional text layer and restores the active object',t=>{
    const {bus,layers,history}=fixture(t),previous=paintLayer(layers,'Previous',2),tool=Object.create(TextTool.prototype);
    Object.assign(tool,{bus,layerManager:layers,history,canEditText:()=>false,computeShadowColor:()=>'#000000',renderTextLayer(){throw Error('Text raster failed');}});
    const editor=Object.create(CanvasTextEditor.prototype);
    Object.assign(editor,{tool,manager:layers,render(){},drag:{kind:'create',point:{x:8,y:8},to:{x:8,y:8},color:'#ffffff',parent:previous,previousId:previous.id}});
    assert.throws(()=>editor.pointerUp(),/Text raster failed/);
    assert.deepEqual(layers.layers,[previous]);assert.equal(layers.activeLayerId,previous.id);assert.equal(history.undoStack.length,0);
});

for(const stage of ['prepare','apply'])test(`failed batch rotation during ${stage} restores objects and releases unowned rotated masters`,t=>{
    const {bus,layers,history,canvases}=fixture(t),first=paintLayer(layers,'First',2),second=paintLayer(layers,'Second',8),snapshots=layers.layers.map(layer=>layer.getImageData());
    const start=canvases.length,tool=Object.create(MoveTool.prototype);
    Object.assign(tool,{bus,layerManager:layers,history,getEditableLayer:()=>first,getAlignmentUnits:()=>layers.layers.map(layer=>({layer,box:layer.sourceRect})),getMoveTargets:layer=>[layer],getResampleMode:()=>'auto',syncBoxWithActiveLayer(){}});
    if(stage==='prepare'){
        const create=document.createElement;document.createElement=()=>{const canvas=create();if(canvases.length===start+2){const get=canvas.getContext.bind(canvas);canvas.getContext=()=>{const ctx=get();ctx.drawImage=()=>{throw Error('Prepare failed');};return ctx;};}return canvas;};
    }else{
        let draws=0;tool.drawResampled=(ctx,source,x,y,w,h)=>{ctx.drawImage(source,x,y,w,h);if(++draws===2)throw Error('Apply failed');};
    }
    assert.equal(transformBatch(tool,'rotate',{angle:90}),false);assert.equal(history.undoStack.length,0);
    layers.layers.forEach((layer,index)=>{assert.deepEqual(layer.canvas.data,snapshots[index].data);assert.equal(layer.sourceCanvas,snapshots[index].mollySnapshot.sourceCanvas);assert.equal(layer.contentRevision,snapshots[index].mollySnapshot.contentRevision);});
    const temporaries=canvases.slice(start);assert.equal(temporaries.length,2);assert.ok(temporaries.every(canvas=>canvas.width===1&&canvas.height===1));
});

test('property changes record history only after applying the value and respect pending invalid input',t=>{
    const {bus,layers,history}=fixture(t),layer=paintLayer(layers,'Object',2),inspector=Object.create(PropertiesInspector.prototype),observed=[];
    const app={bus,layerManager:layers,history,tools:{finishDocument:()=>true}};
    Object.assign(inspector,{app,get:()=>null,sync(){}});bus.on('HISTORY_CHANGED',()=>observed.push(layer.opacity));
    inspector.setProperty(layer,'opacity',.5);assert.deepEqual(observed,[.5]);assert.equal(history.undoStack.length,1);
    app.tools.finishDocument=()=>false;assert.equal(inspector.setProperty(layer,'opacity',.25),false);assert.equal(layer.opacity,.5);assert.equal(history.undoStack.length,1);
    history.undo();assert.equal(layer.opacity,1);
});
