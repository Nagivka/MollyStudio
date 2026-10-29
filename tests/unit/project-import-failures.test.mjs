import test from 'node:test';
import assert from 'node:assert/strict';
import ProjectManager from '../../src/renderer/js/core/ProjectManager.mjs';
import {normalizeWorkspaceState} from '../../src/renderer/js/core/WorkspaceState.mjs';
import {RasterCanvas} from '../helpers/raster-canvas.mjs';
import {pngData} from '../helpers/png.mjs';

function scoped(t,key,value){const old=globalThis[key];globalThis[key]=value;t.after(()=>{globalThis[key]=old;});}

test('legacy null and invalid workspace metadata normalize without breaking an imported tab',()=>{
    const defaults=normalizeWorkspaceState();
    for(const value of [null,false,12,'old',[]])assert.deepEqual(normalizeWorkspaceState(value),defaults);
});

function fixture(t,{failImage=0}={}) {
    const canvases=[];let decoded=0;
    scoped(t,'document',{createElement:()=>{const canvas=new RasterCanvas();canvases.push(canvas);return canvas;}});
    scoped(t,'Image',class{
        width=8;height=8;naturalWidth=8;naturalHeight=8;data=new Uint8ClampedArray(8*8*4);
        set src(value){const index=++decoded;queueMicrotask(()=>index===failImage?this.onerror():this.onload());}
    });
    const existing={id:'existing'},app={projects:[existing],activeProjectId:existing.id};
    const manager=new ProjectManager(app);
    const document={type:'canvas',config:{width:8,height:8},layers:[{id:'a',width:8,height:8,dataUrl:pngData(8,8)},{id:'b',width:8,height:8,dataUrl:pngData(8,8)}]};
    return {manager,app,existing,canvases,document};
}

test('a corrupt later image releases every staged canvas and retains the previously open project',async t=>{
    const {manager,app,existing,canvases,document}=fixture(t,{failImage:2});
    await assert.rejects(manager.deserializeProject(document),/декодировать/);
    assert.equal(app.activeProjectId,'existing');assert.deepEqual(app.projects,[existing]);
    assert.equal(canvases.length,4);assert.ok(canvases.every(canvas=>canvas.width===1&&canvas.height===1));
});

test('an import refused by recovery storage frees its decoded images before creating a tab',async t=>{
    const {manager,app,existing,canvases,document}=fixture(t);manager.flushAutosaves=async()=>false;
    await assert.rejects(manager.deserializeProject(document),/сохранить открытые черновики/);
    assert.deepEqual(app.projects,[existing]);assert.ok(canvases.every(canvas=>canvas.width===1&&canvas.height===1));
});

test('a failed master draw releases the source canvas even before it is attached to the layer',async t=>{
    const {manager,app,existing,canvases,document}=fixture(t);document.layers=[{id:'a',width:8,height:8,sourceDataUrl:pngData(8,8),sourceRect:{x:0,y:0,w:8,h:8}}];
    const create=globalThis.document.createElement;
    globalThis.document.createElement=()=>{
        const canvas=create();
        if(canvases.length===3){const get=canvas.getContext.bind(canvas);canvas.getContext=()=>{const ctx=get(),draw=ctx.drawImage.bind(ctx);ctx.drawImage=(...args)=>{draw(...args);throw Error('master draw failed');};return ctx;};}
        return canvas;
    };
    await assert.rejects(manager.deserializeProject(document),/master draw failed/);
    assert.deepEqual(app.projects,[existing]);assert.equal(canvases.length,3);
    assert.ok(canvases.every(canvas=>canvas.width===1&&canvas.height===1));
});
