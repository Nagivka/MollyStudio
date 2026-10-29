import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PNG} from 'pngjs';
import {createExportArchive,crc32} from '../../src/renderer/js/graphics/ExportArchive.mjs';
import {polygonSelection,colorSelection} from '../../src/renderer/js/tools/PixelSelection.mjs';
import {containsPixel,combineSelection,regionsOf} from '../../src/renderer/js/tools/SelectionGeometry.mjs';
import {PREFIX_DESIGNS,GUI_DESIGNS,applyPrefixDesign,recolorGuiPixels} from '../../src/renderer/js/core/DesignPresets.mjs';
import {normalizePrefixDocument} from '../../src/renderer/js/core/PrefixDocument.mjs';
import PrefixRenderer from '../../src/renderer/js/graphics/PrefixRenderer.js';
import {RasterCanvas} from '../helpers/raster-canvas.mjs';
import MarqueeTool from '../../src/renderer/js/tools/MarqueeTool.js';
import MoveTool from '../../src/renderer/js/tools/MoveTool.js';
import ToolManager from '../../src/renderer/js/tools/ToolManager.js';
import EventBus from '../../src/renderer/js/core/EventBus.js';
import {fontMaps,normalizeBitmapText,resolveBitmapGlyph} from '../../src/renderer/js/utils/FontData.js';
import TextTool from '../../src/renderer/js/tools/TextTool.js';
import {validateProjectDocument} from '../../src/renderer/js/core/ProjectValidation.mjs';

test('Square atlas resolves the complete Russian and English alphabets and digits',async()=>{
    const atlas=PNG.sync.read(await readFile(new URL('../../src/renderer/assets/images/square.png',import.meta.url)));
    const input='abcdefghijklmnopqrstuvwxyz абвгдеёжзийклмнопрстуфхцчшщъыьэюя 0123456789';
    const normalized=normalizeBitmapText(input,'square');
    assert.equal(normalized,input.toUpperCase());
    for(const character of normalized.replaceAll(' ','')){
        const {fontId,index}=resolveBitmapGlyph(character,'square');
        assert.equal(fontId,'square',character);assert.ok(index>=0,character);
        let ink=0;
        for(let y=0;y<8;y++)for(let x=0;x<8;x++)ink+=atlas.data[((Math.floor(index/16)*8+y)*atlas.width+index%16*8+x)*4+3];
        assert.ok(ink>0,`${character} must resolve to a nonempty Square tile`);
    }
    assert.equal(resolveBitmapGlyph('!','square').fontId,'square');
    const project={name:'Square',type:'canvas',config:{width:64,height:32},layers:[{id:'text',width:64,height:32,type:'text',textData:{text:input,fontId:'square'}}]};
    assert.doesNotThrow(()=>validateProjectDocument(JSON.parse(JSON.stringify(project))));
    assert.equal(normalizePrefixDocument({blocks:[{text:input,font:'square'}]}).blocks[0].font,'square');
});

test('Square uses its new signs while SmallCaps uses Default, retaining each font digits',()=>{
    for(const font of ['square','smallcaps']){
        for(const character of '!"#$%&\'()*+,-./:;<=>?@[\\]^_{|}~«»'){
            const source=font==='square'?'square':'minecraft';
            assert.deepEqual(resolveBitmapGlyph(character,font),{fontId:source,index:fontMaps[source].indexOf(character)},font+': '+character);
        }
        for(const character of '0123456789')assert.deepEqual(resolveBitmapGlyph(character,font),{fontId:font,index:fontMaps[font].indexOf(character)});
        assert.equal(normalizeBitmapText('«» —…',font),'«» -...');
    }
});

test('new Square signs and shifted letter rows point to nonempty bitmap tiles',async()=>{
    const atlas=PNG.sync.read(await readFile(new URL('../../src/renderer/assets/images/square.png',import.meta.url)));
    for(const [char,index] of [['!',1],['0',16],['@',32],['A',33],['[',59],['`',64],['А',69],['Ё',100],['Й',101],['«',112],['»',113]])assert.equal(fontMaps.square.indexOf(char),index,char);
    for(const char of fontMaps.square.replaceAll(' ','')){
        const index=fontMaps.square.indexOf(char);let ink=0;
        for(let y=0;y<8;y++)for(let x=0;x<8;x++)ink+=atlas.data[((Math.floor(index/16)*8+y)*atlas.width+index%16*8+x)*4+3];
        assert.ok(ink>0,char);
    }
});

test('updated Minecraft atlas resolves punctuation and shifted Latin/Cyrillic rows',async()=>{
    const atlas=PNG.sync.read(await readFile(new URL('../../src/renderer/assets/images/default.png',import.meta.url)));
    for(const [char,index] of [['!',1],['0',16],['?',31],['@',32],['A',33],['a',65],['«',96],['»',97],['А',102],['ё',164]]){
        assert.equal(fontMaps.minecraft.indexOf(char),index,char);
        let ink=0;
        for(let y=0;y<8;y++)for(let x=0;x<8;x++)ink+=atlas.data[((Math.floor(index/16)*8+y)*atlas.width+index%16*8+x)*4+3];
        assert.ok(ink>0,`${char} must resolve to a nonempty tile`);
    }
    assert.equal(normalizeBitmapText('«Привет!»', 'minecraft'),'«Привет!»');
    assert.equal(normalizeBitmapText('«Hello»', 'minecraft-ten'),'"Hello"');
});

test('image ZIP names reject directory traversal, duplicates and absolute paths',()=>{
    assert.throws(()=>createExportArchive([{name:'assets/file.json',data:'{}'}]),/имя/);
    for(const name of ['../file','a/../file','/file','C:/file','a\\file','a//file','a/./file'])assert.throws(()=>createExportArchive([{name,data:'{}'}]),/имя/);
    assert.throws(()=>createExportArchive([{name:'image.png',data:''},{name:'IMAGE.png',data:''}]),/имя/);
    const zip=createExportArchive([{name:'manifest.json',data:'{}'}]),view=new DataView(zip.buffer);
    assert.equal(view.getUint32(14,true),crc32(new TextEncoder().encode('{}')));assert.equal(view.getUint16(8,true),0);
});
test('polygon selection follows pixel centres, clips the canvas and supports concave paths',()=>{
    const rect=polygonSelection([{x:-2,y:-2},{x:4,y:-2},{x:4,y:4},{x:-2,y:4}],8,8);assert.deepEqual(rect,{x:0,y:0,width:4,height:4});
    const l=polygonSelection([{x:0,y:0},{x:6,y:0},{x:6,y:2},{x:2,y:2},{x:2,y:6},{x:0,y:6}],8,8);
    assert.equal(containsPixel(l,1,5),true);assert.equal(containsPixel(l,5,1),true);assert.equal(containsPixel(l,3,3),false);
    assert.equal(polygonSelection([{x:1,y:1},{x:2,y:2}],8,8),null);
    const cut=combineSelection(rect,l,'subtract');assert.equal(containsPixel(cut,3,3),true);assert.equal(containsPixel(cut,1,1),false);
});
test('magic wand distinguishes connected and global color matching with tolerance and transparent RGB',()=>{
    const image={width:5,height:1,data:Uint8ClampedArray.from([255,0,0,255,250,0,0,255,0,0,255,255,255,0,0,255,10,20,30,0])};
    const exact=colorSelection(image,0,0);assert.equal(exact.width,1);
    const connected=colorSelection(image,0,0,{tolerance:5});assert.equal(connected.width,2);assert.equal(containsPixel(connected,3,0),false);
    const all=colorSelection(image,0,0,{tolerance:5,contiguous:false});assert.equal(containsPixel(all,3,0),true);assert.equal(containsPixel(all,2,0),false);
    assert.equal(colorSelection(image,-1,0),null);
    const transparent={width:2,height:1,data:Uint8ClampedArray.from([255,0,0,0,0,255,0,0])};assert.equal(colorSelection(transparent,0,0).width,2);
});
test('magic wand visits a large uniform area without recursive flood fill',()=>{
    const image={width:512,height:256,data:new Uint8ClampedArray(512*256*4)};
    const area=colorSelection(image,255,128);assert.deepEqual(area,{x:0,y:0,width:512,height:256});
});
test('designs preserve prefix content and normalize every color and corner',()=>{
    const block=normalizePrefixDocument({blocks:[{id:'saved',text:'АДМИН',font:'minecraft-ten'}]}).blocks[0];
    assert.equal(PREFIX_DESIGNS.length,20);assert.equal(GUI_DESIGNS.length,76);
    for(const preset of PREFIX_DESIGNS){const result=applyPrefixDesign(block,preset.id);assert.equal(result.text,'АДМИН');assert.equal(result.font,'minecraft-ten');assert.equal(result.id,'saved');assert.deepEqual(normalizePrefixDocument({blocks:[result]}).blocks[0],result);}
});
test('GUI designs preserve transparency, geometry and colored details',()=>{
    const original=Uint8ClampedArray.from([198,198,198,255,255,0,0,255,12,12,12,0]);
    for(const theme of GUI_DESIGNS){const image={width:3,height:1,data:original.slice()};recolorGuiPixels(image,theme.id);assert.equal(image.data[3],255);assert.deepEqual([...image.data.slice(4,8)],[255,0,0,255]);assert.equal(image.data[11],0);}
});
test('prefix raster renderer uses real atlases for every design',async()=>{
    const oldDocument=globalThis.document;globalThis.document={createElement:()=>new RasterCanvas()};
    try{
        const renderer=new PrefixRenderer();
        for(const [font,file] of [['minecraft','default.png'],['smallcaps','smallcaps.png'],['square','square.png'],['minecraft-ten','ten.png']])renderer.images[font]=PNG.sync.read(await readFile(new URL(`../../src/renderer/assets/images/${file}`,import.meta.url)));
        const data=normalizePrefixDocument({blocks:[{text:'VIP'}]});
        for(const preset of PREFIX_DESIGNS){const styled=renderer.render({...data,blocks:[applyPrefixDesign(data.blocks[0],preset.id)]});assert.ok(styled.canvas.width>0);assert.ok(styled.canvas.data.some(value=>value>0));}
        const square=renderer.render(normalizePrefixDocument({blocks:[{text:'Привет Hello ЁЙ 0123!?',font:'square'}]}));
        assert.deepEqual(square.missing,[]);assert.ok(square.canvas.data.some((value,index)=>index%4===3&&value));
    }finally{globalThis.document=oldDocument;}
});

test('lasso gestures create a shared selection and cancellation retains the previous mask',()=>{
    const oldDocument=globalThis.document,oldWindow=globalThis.window;globalThis.document={getElementById:()=>null};globalThis.window={};
    try{
        const tool=Object.create(MarqueeTool.prototype);tool.layerManager={config:{width:20,height:20}};tool.bus=new EventBus();tool.toolManager={currentToolId:'lasso'};
        tool.startAntsAnimation=()=>{};tool.stopAntsAnimation=()=>{};tool.updatePreview=()=>{};tool.renderSelectionOverlay=()=>{};
        tool.onPointerDown(2,2,null,null,null,{});tool.onPointerMove(8,2);tool.onPointerMove(8,8);tool.onPointerMove(2,8);tool.onPointerUp(2,2);
        assert.deepEqual(tool.selection,{x:2,y:2,width:6,height:6});assert.equal(tool.isSelecting,false);
        const previous=tool.selection;tool.onPointerDown(10,10,null,null,null,{});tool.onPointerMove(15,15);tool.cancelAction();assert.strictEqual(tool.selection,previous);
        tool.onPointerDown(4,4,null,null,null,{altKey:true});tool.onPointerMove(6,4);tool.onPointerMove(6,6);tool.onPointerMove(4,6);tool.onPointerUp(4,4);
        assert.equal(containsPixel(tool.selection,4,4),false);assert.equal(containsPixel(tool.selection,2,2),true);
    }finally{globalThis.document=oldDocument;globalThis.window=oldWindow;}
});

test('wand selection is used by numeric properties without modifying its source layer',()=>{
    const oldDocument=globalThis.document,oldWindow=globalThis.window;globalThis.document={getElementById:()=>null};globalThis.window={};
    try{
        const tool=Object.create(MarqueeTool.prototype);tool.layerManager={config:{width:3,height:1}};tool.bus=new EventBus();tool.toolManager={currentToolId:'wand'};tool.startAntsAnimation=()=>{};tool.updatePreview=()=>{};
        const image={width:3,height:1,data:Uint8ClampedArray.from([255,0,0,255,255,0,0,255,0,0,255,255])},layer={ctx:{getImageData:()=>image},width:3,height:1};
        tool.onPointerDown(0,0,null,null,layer,{});assert.deepEqual(tool.selection,{x:0,y:0,width:2,height:1});assert.equal(tool.hasFloating(),false);
        globalThis.window.mollyEditor={tools:{currentToolId:'wand',tools:{marquee:tool}}};const move=Object.create(MoveTool.prototype);assert.equal(move.getActiveSelection(),tool);
    }finally{globalThis.document=oldDocument;globalThis.window=oldWindow;}
});

test('selection aliases share their mask while only the chosen toolbar button is pressed',()=>{
    const oldDocument=globalThis.document;
    const buttons=['marquee','lasso','wand'].map(id=>({dataset:{tool:id},setAttribute(name,value){this[name]=value;},classList:{toggle(){}}}));
    globalThis.document={querySelectorAll:()=>buttons};
    try{
        const manager=Object.create(ToolManager.prototype),selection={};manager.tools={marquee:selection,lasso:selection,wand:selection};manager.currentToolId='marquee';manager.bus=new EventBus();manager.updateContextualOptions=()=>{};
        manager.setTool('lasso');assert.deepEqual(buttons.map(button=>button['aria-pressed']),['false','true','false']);
        manager.setTool('wand');assert.deepEqual(buttons.map(button=>button['aria-pressed']),['false','false','true']);assert.equal(manager.tools.wand,selection);
    }finally{globalThis.document=oldDocument;}
});

