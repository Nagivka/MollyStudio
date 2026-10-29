import test from 'node:test';
import assert from 'node:assert/strict';
import {RasterCanvas} from '../helpers/raster-canvas.mjs';
import {drawLayers} from '../../src/renderer/js/graphics/LayerCompositing.js';
import {prepareExportCanvas} from '../../src/renderer/js/graphics/ExportImage.js';
import ExportPanel from '../../src/renderer/js/ui/ExportPanel.js';

function canvases(t,prepare=()=>{}){
    const saved=globalThis.document,created=[];t.after(()=>{globalThis.document=saved;});
    globalThis.document={createElement(){const canvas=new RasterCanvas();created.push(canvas);
        const get=canvas.getContext.bind(canvas);canvas.getContext=(...args)=>{const ctx=get(...args);prepare(ctx);return ctx;};return canvas;}};
    return created;
}

test('a failed scaled export releases its output without destroying the source image',t=>{
    const created=canvases(t,ctx=>{ctx.drawImage=()=>{throw Error('draw failed');};}),source=new RasterCanvas(12,8);
    source.context.fillStyle='#ffffff';source.context.fillRect(0,0,12,8);const pixels=source.data.slice();
    assert.throws(()=>prepareExportCanvas(source,{scale:4}),/draw failed/);
    assert.equal(created.length,1);assert.equal(created[0].width,1);assert.equal(created[0].height,1);
    assert.equal(source.width,12);assert.equal(source.height,8);assert.deepEqual(source.data,pixels);
});

test('export source preparation releases its canvas when a layer effect cannot render',t=>{
    const created=canvases(t),panel=new ExportPanel({activeProjectId:'p',projectManager:{getRevision:()=>1}});
    const layer={id:'a',visible:true,width:12,height:8,contentRevision:1,getRenderCanvas(){throw Error('effect failed');}};
    panel.context={id:'p',revision:1,layers:[layer],config:{width:12,height:8}};
    assert.throws(()=>panel.source({},{}),/effect failed/);
    assert.equal(created.length,1);assert.equal(created[0].width,1);assert.equal(created[0].height,1);
    assert.equal(layer.width,12);assert.equal(layer.height,8);
});

test('failed group compositing cannot reuse a partial image after returning to the previous revision',t=>{
    let fail=false;const created=canvases(t,ctx=>{
        if(ctx.checked)return;ctx.checked=true;const draw=ctx.drawImage.bind(ctx);
        ctx.drawImage=(image,...args)=>{draw(image,...args);if(fail)throw Error('group draw failed');};
    });
    const source=new RasterCanvas(4,4);source.context.fillStyle='#ff0000';source.context.fillRect(0,0,4,4);
    const group={id:'group',isGroup:true,width:4,height:4,contentRevision:0};
    const layer={id:'a',groupId:'group',width:4,height:4,contentRevision:1,canvas:source};
    const layers=[group,layer],output=new RasterCanvas(4,4);drawLayers(output.context,layers);
    assert.deepEqual(output.data,source.data);const initial=source.data.slice();
    source.context.fillStyle='#00ff00';source.context.fillRect(0,0,4,4);layer.contentRevision=2;fail=true;
    assert.throws(()=>drawLayers(output.context,layers),/group draw failed/);
    assert.equal(created[0].width,1);assert.equal(created[0].height,1);
    fail=false;source.data.set(initial);layer.contentRevision=1;output.context.clearRect(0,0,4,4);
    drawLayers(output.context,layers);
    assert.deepEqual(output.data,initial);assert.equal(created.length,2);
});
