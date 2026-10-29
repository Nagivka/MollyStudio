import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PNG} from 'pngjs';
import {SURFACE_TEXTURES,normalizeTexture,applySurfaceTexture} from '../../src/renderer/js/graphics/SurfaceTexture.mjs';
import {normalizePrefixDocument} from '../../src/renderer/js/core/PrefixDocument.mjs';
import PrefixRenderer from '../../src/renderer/js/graphics/PrefixRenderer.js';
import Layer from '../../src/renderer/js/graphics/Layer.js';
import {LayerFXCommand} from '../../src/renderer/js/core/Commands.js';
import {estimateCommandBytes} from '../../src/renderer/js/core/History.js';
import ProjectManager from '../../src/renderer/js/core/ProjectManager.mjs';
import ExportPanel from '../../src/renderer/js/ui/ExportPanel.js';
import SettingsManager from '../../src/renderer/js/core/SettingsManager.js';
import {colorSelection} from '../../src/renderer/js/tools/PixelSelection.mjs';
import {RasterCanvas} from '../helpers/raster-canvas.mjs';
import LayerManager from '../../src/renderer/js/graphics/LayerManager.js';
import EventBus from '../../src/renderer/js/core/EventBus.js';
import GuiPreviewPanel from '../../src/renderer/js/ui/GuiPreviewPanel.js';
import {createProjectThumbnail} from '../../src/renderer/js/ui/ProjectThumbnail.js';
import {pngData} from '../helpers/png.mjs';
import {drawLayers} from '../../src/renderer/js/graphics/LayerCompositing.js';

function pixels(width=32,height=24){const data=new Uint8ClampedArray(width*height*4);for(let i=0;i<data.length;i+=4)data.set([100,140,180,200],i);return {width,height,data};}
async function withCanvas(fn){const saved=globalThis.document;globalThis.document={createElement:()=>new RasterCanvas()};try{return await fn();}finally{globalThis.document=saved;}}
async function renderer(){const r=new PrefixRenderer();for(const [font,file] of [['minecraft','default.png'],['smallcaps','smallcaps.png'],['minecraft-ten','ten.png']])r.images[font]=PNG.sync.read(await readFile(new URL(`../../src/renderer/assets/images/${file}`,import.meta.url)));return r;}

test('surface patterns are deterministic, bounded and preserve alpha and hidden RGB',()=>{
    for(const item of SURFACE_TEXTURES.filter(item=>item.id!=='none')){
        const a=pixels(),b=pixels();a.data.set([1,2,3,0],0);b.data.set([1,2,3,0],0);
        const settings={type:item.id,amount:37,scale:2,seed:132};applySurfaceTexture(a,settings);applySurfaceTexture(b,settings);
        assert.deepEqual(a,b,item.id);assert.deepEqual([...a.data.slice(0,4)],[1,2,3,0]);
        assert.notDeepEqual(a.data,pixels().data);for(let i=7;i<a.data.length;i+=4)assert.equal(a.data[i],200);
    }
    for(const settings of [{type:'none'},{type:'grain',amount:0}]){const a=pixels(),before=a.data.slice();applySurfaceTexture(a,settings);assert.deepEqual(a.data,before);}
});
test('texture scale, seed and invalid imported settings are normalized',()=>{
    assert.deepEqual(normalizeTexture({type:'unknown',amount:200,scale:-4,seed:Infinity}),{type:'none',amount:100,scale:1,seed:1});
    const a=pixels(),b=pixels(),c=pixels();applySurfaceTexture(a,{type:'grain',seed:1});applySurfaceTexture(b,{type:'grain',seed:2});applySurfaceTexture(c,{type:'grain',scale:4});assert.notDeepEqual(a,b);assert.notDeepEqual(a,c);
    assert.equal(normalizeTexture(null).type,'none');
});
test('background texture respects its pixel mask',()=>{
    const a=pixels(),before=a.data.slice();applySurfaceTexture(a,{type:'checker',amount:100},(x,y)=>x>2&&y>2);
    for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++)if(x<=2||y<=2){const i=(y*a.width+x)*4;assert.deepEqual(a.data.slice(i,i+4),before.slice(i,i+4));}
});
test('prefix grain affects only background fill, with stable saved settings',()=>withCanvas(async()=>{
    const r=await renderer(),doc=normalizePrefixDocument({blocks:[{text:'VIP',background:'solid',backgroundColors:['#808080'],textColors:['#FF0000'],textShadow:false,paddingX:8,paddingY:6,bevel:false,borderWidth:1,borderColor:'#000000',radius:0}]});
    const before=r.render(doc).canvas.data.slice();doc.blocks[0].texture={type:'grain',amount:60,scale:1,seed:42};
    const output=r.render(doc).canvas;assert.notDeepEqual(before,output.data);
    for(let i=0;i<before.length;i+=4)if(before[i]===255||before[i]===0)assert.deepEqual(output.data.slice(i,i+4),before.slice(i,i+4));
    assert.deepEqual(r.render(JSON.parse(JSON.stringify(doc))).canvas.data,output.data);
}));
test('layer texture is reversible and preserves the pristine master and source pixels',()=>withCanvas(()=>{
    const layer=new Layer('a','Layer',12,8);layer.ctx.putImageData(pixels(12,8),0,0);layer.invalidateSource();
    layer.setMasterSource(layer.cloneCanvas(),{x:0,y:0,w:12,h:8});const source=layer.sourceCanvas,before=layer.canvas.data.slice(),beforeFX=structuredClone(layer.fx);
    const cmd=new LayerFXCommand(layer,beforeFX,{...beforeFX,texture:{type:'grain',amount:30,seed:17}},null);cmd.execute();
    const rendered=layer.getRenderCanvas().data.slice();assert.notDeepEqual(rendered,before);assert.deepEqual(layer.canvas.data,before);assert.equal(layer.sourceCanvas,source);
    cmd.undo();assert.equal(layer.getRenderCanvas(),layer.canvas);assert.equal(layer.fxCanvas,null);assert.equal(layer.fxScratch.texture,undefined);
    cmd.execute();assert.deepEqual(layer.getRenderCanvas().data,rendered);assert.ok(estimateCommandBytes(cmd)>0);
}));
test('MLST serialization retains layer texture and no longer writes removed pack assignments',()=>withCanvas(()=>{
    const layer=new Layer('a','Layer',12,8);layer.setFX({texture:{type:'grain',seed:42,amount:30,scale:2}});layer.canvas.toDataURL=()=> 'data:image/png;base64,AAAA';
    const project={id:'p',name:'test',type:'gui',config:{width:12,height:8},layers:[layer],resourcePack:{id:'obsolete'}},app={projects:[project],activeProjectId:'p',config:project.config,layerManager:{getLayers:()=>[layer]}};
    const manager=new ProjectManager(app),document=manager.serializeProject();assert.deepEqual(document.layers[0].fx.texture,layer.fx.texture);assert.equal(Object.hasOwn(document,'resourcePack'),false);
    const before=manager.getDocumentFingerprint('p');layer.setFX({texture:{type:'dots'}});assert.notEqual(manager.getDocumentFingerprint('p'),before);
}));
test('malformed imported layer effects cannot send infinite shadow coordinates to canvas',()=>withCanvas(()=>{
    const layer=new Layer('a','',4,4);layer.setFX({shadow:'invalid',texture:{type:'grain',scale:0}});assert.equal(layer.fx.shadow,undefined);assert.equal(layer.fx.texture.scale,1);
    layer.setFX({shadow:{enabled:true,offsetX:Infinity,offsetY:1e10}});assert.equal(layer.fx.shadow.offsetX,1);assert.equal(layer.fx.shadow.offsetY,4096);
    layer.setFX('invalid');assert.equal(layer.fx,null);
}));
test('hidden sprite-sheet numeric fields do not block exporting a PNG',()=>{
    const controls=Object.fromEntries(['source','scale','trim','format','columns','gap','prefix','numbered','names','block'].map(key=>[key,{value:'',type:'text'}]));
    Object.assign(controls.format,{value:'png'});Object.assign(controls.columns,{type:'number',value:'',min:'1',max:'32',setAttribute(){}});
    const panel=Object.create(ExportPanel.prototype);panel.get=key=>controls[key];panel.dialog={querySelectorAll:()=>[controls.columns]};
    assert.doesNotThrow(()=>panel.read());controls.format.value='sheet';assert.throws(()=>panel.read(),/числовые/);
});
test('complex global wand selection fails with a useful error instead of retaining millions of spans',()=>{
    const image=pixels(512,64);for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)image.data[(y*image.width+x)*4]=(x+y)%2?0:255;
    assert.throws(()=>colorSelection(image,0,0,{contiguous:false}),/слишком сложное/);
});
test('settings received from another window apply normalized values and ignore unknown keys',()=>{
    const savedWindow=globalThis.window,savedApply=SettingsManager.prototype.apply,savedAll=SettingsManager.prototype.applyAll,savedLoad=SettingsManager.prototype.loadSettings;
    let receive;const applied=[];globalThis.window={desktopAPI:{onSettingsUpdated:fn=>receive=fn},addEventListener(){}};
    SettingsManager.prototype.applyAll=()=>{};SettingsManager.prototype.loadSettings=function(){return this.normalizeSettings({});};SettingsManager.prototype.apply=(...args)=>applied.push(args);
    try{new SettingsManager({emit(){}});receive({key:'uiScale',value:'999%'});assert.deepEqual(applied,[['uiScale','100%']]);receive({key:'unknown',value:'bad'});assert.equal(applied.length,1);}
    finally{globalThis.window=savedWindow;SettingsManager.prototype.apply=savedApply;SettingsManager.prototype.applyAll=savedAll;SettingsManager.prototype.loadSettings=savedLoad;}
});
test('merging images bakes their texture once and clears obsolete object metadata',()=>withCanvas(()=>{
    const manager=new LayerManager(new EventBus(),{width:12,height:8}),lower=manager.addLayer('Button'),upper=manager.addLayer('Drawing');
    lower.objectType='button';lower.ctx.putImageData(pixels(12,8),0,0);lower.setFX({texture:{type:'grain',seed:22}});
    const expected=lower.getRenderCanvas().data.slice();const result=manager.mergeDown(upper.id);
    assert.ok(result);assert.deepEqual(lower.canvas.data,expected);assert.equal(lower.fx,null);assert.equal(lower.objectType,null);assert.equal(manager.layers.length,1);
}));
test('GUI preview coalesces repeated canvas updates into one frame',()=>{
    const oldDocument=globalThis.document,oldFrame=globalThis.requestAnimationFrame;let callback,scheduled=0,renders=0;
    globalThis.document={getElementById:()=>null};globalThis.requestAnimationFrame=fn=>{callback=fn;scheduled++;return scheduled;};
    try{const bus=new EventBus(),panel=new GuiPreviewPanel({bus});panel.dialog={open:true};panel.render=()=>renders++;
        bus.emit('CANVAS_UPDATED');bus.emit('CANVAS_UPDATED');bus.emit('CANVAS_UPDATED');assert.equal(scheduled,1);callback();assert.equal(renders,1);
        panel.dialog.open=false;bus.emit('CANVAS_UPDATED');assert.equal(scheduled,1);
    }finally{globalThis.document=oldDocument;globalThis.requestAnimationFrame=oldFrame;}
});
test('saved thumbnails render texture, skip hidden groups and release large temporary canvases',async()=>{
    const oldDocument=globalThis.document,oldImage=globalThis.Image,canvases=[],drawn=[],decoded=[];
    let finalPixels;
    globalThis.document={createElement:()=>{
        const canvas=new RasterCanvas();canvases.push(canvas);
        const get=canvas.getContext.bind(canvas);
        canvas.getContext=()=>{const ctx=get();ctx.translate=()=>{};ctx.scale=()=>{};
            if(!ctx.tracked){const draw=ctx.drawImage.bind(ctx);ctx.drawImage=(image,...args)=>{drawn.push(image.data?.slice());draw(image,...args);};ctx.tracked=true;}
            return ctx;};
        canvas.toDataURL=()=>{finalPixels=canvas.data.slice();return 'data:image/png;base64,BB==';};return canvas;
    }};
    globalThis.Image=class {set src(value){decoded.push(value);Object.assign(this,pixels(8,8),{naturalWidth:8,naturalHeight:8});queueMicrotask(()=>this.onload());}};
    try{
        const project={type:'canvas',config:{width:8,height:8},layers:[
            {id:'g',type:'group',isGroup:true,visible:false,width:8,height:8},
            {id:'hidden',groupId:'g',width:8,height:8,dataUrl:pngData(8,8)},
            {id:'shown',width:8,height:8,dataUrl:pngData(8,8),fx:{texture:{type:'grain',seed:9,amount:35}}}
        ]};
        const result=await createProjectThumbnail(project);
        assert.equal(result.width,8);assert.equal(decoded.length,1,'hidden descendants are not decoded');
        const expected=applySurfaceTexture(pixels(8,8),{type:'grain',seed:9,amount:35}).data;
        assert.ok(drawn.some(data=>data?.length===expected.length&&data.every((value,index)=>value===expected[index])),'thumbnail composites the textured image');
        assert.ok(finalPixels.some(value=>value>0));assert.ok(canvases.every(canvas=>canvas.width===1&&canvas.height===1));
    }finally{globalThis.document=oldDocument;globalThis.Image=oldImage;}
});
test('nested compositing refreshes changed texture and undo without touching source pixels',()=>withCanvas(()=>{
    const outer=new Layer('outer','',8,8,'group'),inner=new Layer('inner','',8,8,'group'),leaf=new Layer('leaf','',8,8);
    inner.groupId=outer.id;leaf.groupId=inner.id;leaf.ctx.putImageData(pixels(8,8),0,0);leaf.invalidateSource();
    const output=new RasterCanvas(8,8),render=()=>{output.context.clearRect(0,0,8,8);drawLayers(output.context,[outer,inner,leaf]);return output.data.slice();};
    const before=render(),command=new LayerFXCommand(leaf,leaf.fx,{texture:{type:'grain',amount:45}},null);
    command.execute();const textured=render();assert.notDeepEqual(textured,before);assert.deepEqual(render(),textured);
    command.undo();assert.deepEqual(render(),before);assert.deepEqual(leaf.canvas.data,pixels(8,8).data);
}));
