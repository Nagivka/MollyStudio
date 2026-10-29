import test from 'node:test';
import assert from 'node:assert/strict';
import Layer from '../../src/renderer/js/graphics/Layer.js';
import MarqueeTool from '../../src/renderer/js/tools/MarqueeTool.js';
import ProjectManager from '../../src/renderer/js/core/ProjectManager.mjs';
import {normalizePrefixDocument} from '../../src/renderer/js/core/PrefixDocument.mjs';
import {RasterCanvas} from '../helpers/raster-canvas.mjs';
import {pngData} from '../helpers/png.mjs';
import PencilTool from '../../src/renderer/js/tools/PencilTool.js';
import BucketTool from '../../src/renderer/js/tools/BucketTool.js';
import MoveTool from '../../src/renderer/js/tools/MoveTool.js';
import {translate} from '../../src/renderer/js/core/Locale.mjs';

function canvasScope(t) {
    const previous=globalThis.document;
    globalThis.document={createElement:()=>new RasterCanvas()};
    t.after(()=>{globalThis.document=previous;});
}

test('anisotropic document scaling preserves the axes of rotated editable text',t=>{
    canvasScope(t);
    for(const rotation of [0,90,180,270]){
        const layer=new Layer('text','',20,20,'text');
        layer.textData={text:'Hello',x:4,y:6,rotation,scaleX:2,scaleY:3};
        layer.scale(40,60);
        assert.equal(layer.textData.x,8);assert.equal(layer.textData.y,18);
        assert.equal(layer.textData.scaleX,rotation%180?6:4);
        assert.equal(layer.textData.scaleY,rotation%180?6:9);
        layer.scale(20,20);
        assert.equal(layer.textData.scaleX,2);assert.equal(layer.textData.scaleY,3);
    }
});

test('cancelling a floating selection restores pixels, master and document revision',t=>{
    canvasScope(t);
    const layer=new Layer('a','',8,8);layer.ctx.fillStyle='#ff0000';layer.ctx.fillRect(1,1,3,3);
    layer.setMasterSource(layer.cloneCanvas(),{x:0,y:0,w:8,h:8});
    const before=layer.getImageData(),revision=layer.contentRevision,master=layer.sourceCanvas;
    layer.clear();
    const tool=Object.create(MarqueeTool.prototype);
    Object.assign(tool,{beforeData:before,floatingLayer:layer,selection:{x:1,y:1,width:3,height:3},bus:{emit(){}},stopAntsAnimation(){}});
    tool.cancelFloating();
    assert.deepEqual(layer.getImageData().data,before.data);
    assert.equal(layer.sourceCanvas,master);assert.equal(layer.contentRevision,revision);
    assert.equal(tool.selection,null);
});

test('Save waits for the prefix raster before serializing it and retains edits made during preparation',async t=>{
    const previous=globalThis.window;t.after(()=>{globalThis.window=previous;});
    let release;const written=[];
    globalThis.window={desktopAPI:{writeFile:async(path,json)=>written.push(JSON.parse(json))}};
    const layer={id:'a',type:'bitmap',width:8,height:8,contentRevision:1,canvas:{toDataURL:()=>pngData(8,8)}};
    const project={id:'p',name:'Prefix',type:'prefix',filePath:'C:/prefix.mlst',config:{width:8,height:8},layers:[layer],prefixData:normalizePrefixDocument(),prefixLoadPromise:new Promise(resolve=>{release=resolve;})};
    const manager=new ProjectManager({projects:[project],activeProjectId:'p',config:project.config,layerManager:{getLayers:()=>project.layers}});
    manager.recordRecentSafely=()=>{};manager.refreshSavedProjectPreview=async()=>{};manager.finishSave=async()=>{};
    const pending=manager.saveProject();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(written.length,0);
    project.prefixData.blocks[0].text='READY';release(true);
    assert.equal(await pending,true);assert.equal(written[0].prefixData.blocks[0].text,'READY');
});

test('failed prefix preparation cannot overwrite the saved file',async t=>{
    const previous=globalThis.window,previousError=console.error;
    t.after(()=>{globalThis.window=previous;console.error=previousError;});console.error=()=>{};
    const writes=[];globalThis.window={desktopAPI:{writeFile:async(...args)=>writes.push(args)}};
    const project={id:'p',filePath:'C:/prefix.mlst',prefixLoadPromise:Promise.resolve(false)};
    const manager=new ProjectManager({projects:[project],activeProjectId:'p'});
    assert.equal(await manager.saveProject(),false);assert.equal(writes.length,0);
    assert.equal(manager.getSaveState('p'),'error');
});

test('resaving legacy prefix metadata removes retired icon settings from inactive tabs',()=>{
    const project={id:'old',type:'prefix',layers:[],prefixData:{blocks:[{text:'VIP',icon:'crown',iconSize:16,iconSide:'left',iconTint:true}]}};
    const manager=new ProjectManager({projects:[project],activeProjectId:'other'});
    const block=manager.serializeProject('old').prefixData.blocks[0];
    assert.equal(block.text,'VIP');
    for(const field of ['icon','iconSize','iconSide','iconTint'])assert.equal(Object.hasOwn(block,field),false);
});

test('a captured pencil pointer far outside the canvas does bounded work and ignores nonfinite input',t=>{
    canvasScope(t);
    const previous=globalThis.window;t.after(()=>{globalThis.window=previous;});globalThis.window={};
    const layer=new Layer('a','',16,16),tool=Object.create(PencilTool.prototype);
    Object.assign(tool,{targetLayer:layer,isDrawing:true,lastX:2,lastY:2,pixelPerfectPoints:[],layerManager:{isEditable:()=>true},bus:{emit(){}}});
    tool.clipToSelection=()=>{};
    let stamps=0;tool.drawSymmetricStamp=()=>{stamps++;};
    tool.onPointerMove(1e9,2,'#ff0000',1,layer);
    assert.ok(stamps<=16);assert.equal(tool.lastX,1e9);
    tool.onPointerMove(NaN,Infinity,'#ff0000',1,layer);assert.equal(tool.lastX,1e9);
});

test('bucket fill treats zero-alpha pixels with different hidden RGB as one area',()=>{
    const tool=Object.create(BucketTool.prototype);tool.isSelectedPixel=()=>true;
    const pixels=Uint32Array.from([0x000000ff,0x0000ff00,0x00ff0000]);
    assert.equal(tool.floodFill(pixels,0,0,3,1,pixels[0],0xff332211,0),true);
    assert.deepEqual([...pixels],[0xff332211,0xff332211,0xff332211]);
});

test('live rotation releases its temporary raster and retains the pristine master',t=>{
    canvasScope(t);
    const layer=new Layer('a','',16,16),master=new RasterCanvas(8,6),temporary=new RasterCanvas(12,12);
    const tool=Object.create(MoveTool.prototype),rect={x:1,y:1,w:12,h:12};
    Object.assign(tool,{targetLayer:layer,boxStart:rect,currentBox:{...rect,angle:.3},hasMoved:true,activeHandle:{id:'rot'},activeSourceCanvas:master,layerManager:{isEditable:()=>true},bus:{emit(){}}});
    tool.createRotatedSource=()=>({canvas:temporary,rect});tool.drawResampled=()=>{};tool.getResampleMode=()=>'auto';
    tool.renderLivePixels();
    assert.equal(temporary.width,1);assert.equal(temporary.height,1);
    assert.equal(master.width,8);assert.equal(master.height,6);
});

test('Save As cannot overwrite another open document even when Windows path spelling differs',async t=>{
    const previousWindow=globalThis.window,previousError=console.error;
    t.after(()=>{globalThis.window=previousWindow;console.error=previousError;});console.error=()=>{};
    const writes=[],notices=[];
    globalThis.window={desktopAPI:{showSaveDialog:async()=>({filePath:'c:/PROJECTS/other.mlst'}),writeProjectFile:async(...args)=>writes.push(args)}};
    const project={id:'p',name:'New',type:'canvas',layers:[],config:{width:8,height:8}};
    const other={id:'other',name:'Other',filePath:'C:\\projects\\Other.mlst'};
    const manager=new ProjectManager({projects:[project,other],activeProjectId:project.id,config:project.config,layerManager:{getLayers:()=>[]},showToast:(message,_icon,_duration,_actions,values)=>notices.push(translate(message,values))});
    assert.equal(await manager.saveProjectAs(),false);assert.equal(writes.length,0);
    assert.match(notices[0],/Файл уже открыт/);assert.equal(project.filePath,undefined);
});

test('shrinking and restoring an odd-sized bitmap keeps its position and original pixels',t=>{
    canvasScope(t);globalThis.document.getElementById=id=>id==='prop-resize-anchor'?{value:'0.5,0.5'}:null;
    const layer=new Layer('a','',32,32),source=new RasterCanvas(7,5);
    for(let i=0;i<source.data.length;i+=4)source.data.set([i%255,255-i%255,77,255],i);
    const rect={x:5,y:6,w:7,h:5};layer.ctx.drawImage(source,rect.x,rect.y);layer.setMasterSource(source,rect);
    const before=layer.getImageData().data.slice(),tool=Object.create(MoveTool.prototype);
    Object.assign(tool,{getEditableLayer:()=>layer,isBatchTarget:()=>false,ensureSourceCanvas:()=>layer.sourceCanvas,getResampleMode:()=>'auto',syncBoxWithActiveLayer(){},history:{push(){}},layerManager:{isEditable:()=>true},bus:{emit(){}}});
    for(let index=0;index<4;index++){tool.setBoxDimensions(2,2);tool.setBoxDimensions(7,5);}
    assert.deepEqual(layer.sourceRect,rect);assert.equal(layer.sourceCanvas,source);
    assert.deepEqual(layer.getImageData().data,before);
});

test('a failed numeric bitmap resize restores pixels, pristine master and shape data',t=>{
    canvasScope(t);globalThis.document.getElementById=()=>null;
    const layer=new Layer('a','',16,16),master=new RasterCanvas(4,4);master.context.fillStyle='#ff0000';master.context.fillRect(0,0,4,4);
    layer.ctx.drawImage(master,2,3);layer.setMasterSource(master,{x:2,y:3,w:4,h:4});layer.shapeData={type:'rect-filled',x0:2,y0:3,x1:5,y1:6};
    const before=layer.getImageData(),tool=Object.create(MoveTool.prototype);let commands=0;
    Object.assign(tool,{getEditableLayer:()=>layer,isBatchTarget:()=>false,ensureSourceCanvas:()=>master,getResampleMode:()=>'auto',syncBoxWithActiveLayer(){},history:{push(){commands++;}},layerManager:{isEditable:()=>true},bus:{emit(){}},drawResampled(){throw Error('draw failed');}});
    assert.equal(tool.setBoxDimensions(8,8),false);assert.deepEqual(layer.getImageData().data,before.data);
    assert.deepEqual(layer.shapeData,before.mollySnapshot.shapeData);assert.equal(layer.sourceCanvas,master);assert.equal(commands,0);
});

test('a failed multi-object translation restores every already-moved object',t=>{
    canvasScope(t);const layers=[new Layer('a','',16,16),new Layer('b','',16,16)];
    for(const layer of layers){layer.ctx.fillStyle='#ff0000';layer.ctx.fillRect(2,3,4,4);layer.setMasterSource(layer.cloneCanvas(),{x:0,y:0,w:16,h:16});}
    const before=layers.map(layer=>layer.getImageData()),tool=Object.create(MoveTool.prototype);let draws=0,commands=0;
    Object.assign(tool,{layerManager:{isEditable:()=>true},ensureSourceCanvas:layer=>layer.sourceCanvas,getResampleMode:()=>'auto',syncBoxWithActiveLayer(){},history:{push(){commands++;}},bus:{emit(){}},drawResampled(ctx,source,x,y,w,h){if(++draws===2)throw Error('draw failed');ctx.drawImage(source,x,y,w,h);}});
    assert.equal(tool.translateItems(layers.map(target=>({target,dx:1,dy:2}))),false);
    layers.forEach((layer,index)=>{assert.deepEqual(layer.getImageData().data,before[index].data);assert.deepEqual(layer.sourceRect,before[index].mollySnapshot.sourceRect);});
    assert.equal(commands,0);
});
