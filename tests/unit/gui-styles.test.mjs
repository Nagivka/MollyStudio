import test from 'node:test';
import assert from 'node:assert/strict';
import {GUI_DESIGNS,recolorGuiPixels} from '../../src/renderer/js/core/GuiDesignPresets.mjs';
import {createGuiProject,normalizeProjectData,buildEditorUrl,normalizeSavedGuiTemplatePath} from '../../src/renderer/js/core/ProjectFactory.mjs';
import {paintPixelPreview,pixelPreviewSize,fittedPixelScale} from '../../src/renderer/js/graphics/PixelPreview.mjs';
import {BUTTON_STYLES,normalizeButtonStyle} from '../../src/renderer/js/graphics/ButtonRenderer.js';
import ButtonGeneratorModel from '../../src/renderer/js/ui/ButtonGeneratorModel.js';
import {RasterCanvas} from '../helpers/raster-canvas.mjs';
import {TITLE_DESIGNS,applyTitleDesign} from '../../src/renderer/js/core/TitleDesignPresets.mjs';
import {normalizeTitleDocument,titleRowSettings} from '../../src/renderer/js/core/TitleDocument.mjs';

test('title designs preserve text and geometry while resetting custom artwork',()=>{
    assert.equal(TITLE_DESIGNS.length,24);
    assert.equal(new Set(TITLE_DESIGNS.map(p=>p.name)).size,24);
    for(const text of ['MOLLY','МОЛЛИ'])for(const preset of TITLE_DESIGNS){
        const data=normalizeTitleDocument({text,depth:12,spacing:2,appearance:{source:'gradient'}});
        const next=normalizeTitleDocument(applyTitleDesign(data,preset));
        assert.equal(next.text,text);assert.equal(next.depth,12);assert.equal(next.spacing,2);
        assert.equal(next.appearance.source,'texture');assert.equal(next.appearance.image,null);
        assert.equal(titleRowSettings(next,0).originalColors,preset.originalColors);
    }
});

test('GUI catalogue retains old designs and adds eight complete, texture-free collections',()=>{
    assert.equal(GUI_DESIGNS.length,100);
    assert.equal(new Set(GUI_DESIGNS.map(item=>item.id)).size,100);
    assert.equal(new Set(GUI_DESIGNS.map(item=>item.name)).size,100);
    for(const id of ['vanilla','slate','stone','oak','spruce','nether','ice','parchment','obsidian','ender','ocean','copper'])assert.ok(GUI_DESIGNS.some(item=>item.id===id));
    const counts=Map.groupBy(GUI_DESIGNS,item=>item.category);
    assert.equal(counts.size,12);
    for(const [category,items] of counts)assert.equal(items.length,category==='Классические'?12:8);
    for(const design of GUI_DESIGNS){
        assert.equal(design.pattern,'none');
        for(const value of [0,36,55,139,198,236,255]){
            const data=new Uint8ClampedArray(Array.from({length:64},()=>[value,value,value,255]).flat());
            recolorGuiPixels({width:8,height:8,data},design.id);
            for(let index=4;index<data.length;index+=4)assert.deepEqual(data.slice(index,index+4),data.slice(0,4),design.id);
        }
    }
});

test('GUI projects support Vanilla and Bedrock while retired styles fall back safely',()=>{
    for(const style of ['default','bedrock'])for(const slots of [9,18,27,36,45,54])for(const frame of [true,false]){
        const project=createGuiProject({template:`container_${slots}`,style,frame});
        assert.equal(project.template,`container/${style}/container_${slots}${frame?'_frame':''}.png`);
        assert.equal(normalizeProjectData(project).template,project.template);
        assert.equal(new URL(buildEditorUrl(project),'https://molly.local/').searchParams.get('template'),project.template);
        assert.equal(project.hasFrame,frame);
    }
    for(const unsupported of ['flat','double','cut'])assert.match(createGuiProject({style:unsupported}).template,/container\/default\//);
    assert.equal(normalizeSavedGuiTemplatePath('container/flat/container_54_frame.png'),'container/default/container_54_frame.png');
    assert.equal(normalizeSavedGuiTemplatePath('assets/images/container/retired/container_9.png'),'assets/images/container/default/container_9.png');
    assert.equal(normalizeSavedGuiTemplatePath('container/bedrock/container_54.png'),'container/bedrock/container_54.png');
    assert.equal(normalizeSavedGuiTemplatePath(null),null);
});

test('pixel previews crop once and copy only original RGBA values at fractional display scales',()=>{
    const source=new RasterCanvas(5,4);source.context.fillStyle='#FF0000';source.context.fillRect(1,1,1,2);source.context.fillStyle='#0000FF';source.context.fillRect(2,1,2,2);
    for(const ratio of [1,1.25,1.5,1.75,2,3])for(const scale of [1,1.5]){
        const target=new RasterCanvas();target.style={};target.dataset={};
        const size=paintPixelPreview(target,source,{region:{x:1,y:1,width:3,height:2},deviceRatio:ratio,scale});
        assert.equal(size.pixelWidth,Math.round(3*ratio*scale));assert.equal(size.pixelHeight,Math.round(2*ratio*scale));
        assert.ok(Math.abs(parseFloat(target.style.width)*ratio-target.width)<1e-8);
        for(let i=0;i<target.data.length;i+=4)assert.ok(['255,0,0,255','0,0,255,255'].includes(String(target.data.slice(i,i+4))));
        assert.equal(target.dataset.sourceWidth,'3');assert.equal(target.dataset.previewScale,String(scale));
    }
    const large=pixelPreviewSize(4096,4096,1.5,4);assert.ok(large.pixelWidth*large.pixelHeight<=16*1024*1024);
});

test('fitted previews use integer physical pixel scales without overflowing their containers',()=>{
    for(const ratio of [1,1.25,1.5,1.75,2,3])for(const [width,height] of [[20,12],[78,9],[176,222],[4096,4096]])for(const [maxWidth,maxHeight] of [[293,257],[4,6],[1,1]]){
        const scale=fittedPixelScale(width,height,maxWidth,maxHeight,{deviceRatio:ratio,maxScale:4});
        const size=pixelPreviewSize(width,height,scale,ratio);
        assert.ok(size.width<=maxWidth+.5/ratio&&size.height<=maxHeight+.5/ratio);
        if(scale*ratio>=1)assert.ok(Math.abs(scale*ratio-Math.round(scale*ratio))<1e-8);
        assert.ok(size.pixelWidth*size.pixelHeight<=maxWidth*ratio*maxHeight*ratio+1000);
    }
});

test('OUTLINE and DOUBLE have concentric, symmetric contours without a lower shadow strip',t=>{
    const old=globalThis.document;globalThis.document={createElement:()=>new RasterCanvas()};t.after(()=>{globalThis.document=old;});
    const renderer=new ButtonGeneratorModel();renderer.colorMode='solid';
    const palette={border:'#000000',highlight:'#010101',surface:'#020202',shadow:'#030303'};
    assert.deepEqual(BUTTON_STYLES,['default','ten','flat','outline','double']);assert.equal(normalizeButtonStyle('cut'),'default');
    for(const style of ['outline','double'])for(const [w,h] of [[1,1],[5,5],[18,18],[52,16],[162,108]])for(const thickness of [1,2,5]){
        const image=renderer.renderButton(w,h,palette,style,100,false,0,thickness),chin=renderer.renderButton(w,h,palette,style,100,false,5,thickness);
        assert.deepEqual(image.data,chin.data);
        for(let y=0;y<h;y++)for(let x=0;x<w;x++){
            const at=(px,py)=>image.data[(py*w+px)*4];
            assert.notEqual(at(x,y),3);assert.equal(at(x,y),at(w-1-x,y));assert.equal(at(x,y),at(x,h-1-y));
        }
    }
    const outline=renderer.renderButton(18,18,palette,'outline',50,true,0,2),double=renderer.renderButton(18,18,palette,'double',100,false,0,1);
    assert.deepEqual(Array.from({length:5},(_,i)=>outline.data[(i*18+i)*4]),[1,1,2,2,2]);
    assert.deepEqual(Array.from({length:5},(_,i)=>double.data[(i*18+i)*4]),[0,1,0,1,2]);
    for(let i=3;i<outline.data.length;i+=4)assert.equal(outline.data[i],128);
});
