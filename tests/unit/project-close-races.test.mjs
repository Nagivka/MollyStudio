import test from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import App from '../../src/renderer/js/core/App.js';
import ProjectManager from '../../src/renderer/js/core/ProjectManager.mjs';
import Layer from '../../src/renderer/js/graphics/Layer.js';
import EventBus from '../../src/renderer/js/core/EventBus.js';
import {RasterCanvas} from '../helpers/raster-canvas.mjs';

function scoped(t,key,value){const old=globalThis[key];globalThis[key]=value;t.after(()=>{globalThis[key]=old;});}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function fixture(t,write) {
    let closeHandler;
    scoped(t,'document',{createElement:()=>new RasterCanvas()});
    scoped(t,'window',{addEventListener(){},desktopAPI:{writeRecoveryDraft:write,onFlushRecoveryDrafts:handler=>{closeHandler=handler;}}});
    scoped(t,'localStorage',{getItem:()=>null,removeItem(){},setItem(){}});
    const layer=new Layer('pixels','',8,8);layer.ctx.fillStyle='#ff0000';layer.ctx.fillRect(0,0,8,8);layer.invalidateSource();
    layer.canvas.toDataURL=()=>{const png=new PNG({width:8,height:8});png.data=Buffer.from(layer.canvas.data);return 'data:image/png;base64,'+PNG.sync.write(png).toString('base64');};
    const bus=new EventBus(),project={id:'p',draftId:'p',name:'Drawing',type:'canvas',layers:[layer],config:{width:8,height:8}};
    const app={projects:[project],activeProjectId:'p',config:project.config,bus,layerManager:{getLayers:()=>project.layers},tools:{tools:{},finishDocument(){if(this.pointerSession){this.pointerSession=null;bus.emit('CANVAS_UPDATED');}return true;}},saveProjectState(){}};
    const manager=new ProjectManager(app);manager.initAutosave();manager.markClean('p');manager.markSaved('p');
    t.after(()=>manager.releaseProject('p'));
    return {app,manager,layer,close:()=>closeHandler()};
}

test('an autosave finishing during a new live stroke cannot mark its preview durably saved',async t=>{
    let release;const gate=new Promise(resolve=>release=resolve),writes=[];
    const {app,manager,layer}=fixture(t,async draft=>{writes.push(draft);if(writes.length===1)await gate;});
    manager.queueAutosave('p');const pending=manager.performAutosave('p');await tick();
    app.tools.pointerSession={};layer.ctx.fillStyle='#0000ff';layer.ctx.fillRect(0,0,8,8);layer.invalidateSource(false);app.bus.emit('CANVAS_UPDATED');
    release();assert.equal(await pending,false);assert.equal(manager.autosaveDirtyIds.has('p'),true);
    app.tools.finishDocument();assert.equal(await manager.performAutosave('p'),true);
    const restored=PNG.sync.read(Buffer.from(writes.at(-1).project.layers[0].dataUrl.split(',')[1],'base64'));
    assert.deepEqual([...restored.data.slice(0,4)],[0,0,255,255]);assert.equal(manager.autosaveDirtyIds.size,0);
});

test('closing flush commits and backs up a stroke that starts during the preceding disk write',async t=>{
    const writes=[];let app,layer;
    const state=fixture(t,async draft=>{
        writes.push(draft);
        if(writes.length===1){app.tools.pointerSession={};layer.ctx.fillStyle='#00ff00';layer.ctx.fillRect(0,0,8,8);layer.invalidateSource(false);app.bus.emit('CANVAS_UPDATED');}
    });({app,layer}=state);const {manager}=state;
    manager.queueAutosave('p');
    assert.equal(await manager.flushProject('p'),true);assert.equal(writes.length,2);
    assert.equal(app.tools.pointerSession,null);assert.equal(manager.autosaveDirtyIds.size,0);
    const restored=PNG.sync.read(Buffer.from(writes.at(-1).project.layers[0].dataUrl.split(',')[1],'base64'));
    assert.deepEqual([...restored.data.slice(0,4)],[0,255,0,255]);
});

test('closing flush keeps a document open when its pending form value is invalid',async t=>{
    let writes=0;const {app,manager}=fixture(t,async()=>{writes++;});
    app.tools.finishDocument=()=>false;manager.queueAutosave('p');
    assert.equal(await manager.flushProject('p'),false);assert.equal(writes,0);assert.equal(app.projects.length,1);
});

test('an exceptional tab-close failure clears its guard so the same tab can be closed again',async t=>{
    scoped(t,'document',{getElementById:()=>null});scoped(t,'requestAnimationFrame',callback=>callback());
    const oldError=console.error;console.error=()=>{};t.after(()=>{console.error=oldError;});
    const project={id:'a',name:'A'},other={id:'b',name:'B'},app=Object.create(App.prototype);let attempts=0;
    Object.assign(app,{projects:[project,other],activeProjectId:'a',tools:{finishDocument:()=>true},settingsManager:{get:()=>false},showToast(){},updateDiscordPresence(){},loadProjectState(id){this.activeProjectId=id;},projectManager:{waitForPendingSaves:async()=>{},flushProject:async()=>{if(++attempts===1)throw Error('storage unavailable');return true;},releaseProject(){}}});
    assert.equal(await app.closeProject('a'),false);assert.equal(project.closing,false);assert.equal(app.projects.length,2);
    assert.equal(await app.closeProject('a'),true);assert.equal(app.activeProjectId,'b');assert.deepEqual(app.projects,[other]);
});

test('a live stroke cancelled after Ctrl+S does not become a false unsaved change',async t=>{
    let release;const gate=new Promise(resolve=>release=resolve);
    const {app,manager,layer}=fixture(t,async()=>{}),project=app.projects[0];
    Object.assign(project,{filePath:'C:/drawing.mlst',fileRevision:'a'.repeat(64)});
    globalThis.window.desktopAPI.writeProjectFile=async()=>{await gate;return 'b'.repeat(64);};
    manager.recordRecentSafely=()=>{};manager.refreshSavedProjectPreview=async()=>{};
    const before=layer.getImageData();manager.queueAutosave('p');
    const pending=manager.saveProject();await tick();
    app.tools.pointerSession={};layer.ctx.fillStyle='#0000ff';layer.ctx.fillRect(0,0,8,8);layer.invalidateSource(false);app.bus.emit('CANVAS_UPDATED');
    release();assert.equal(await pending,true);
    layer.putImageData(before);layer.contentRevision=before.mollySnapshot.contentRevision;app.tools.pointerSession=null;app.bus.emit('CANVAS_UPDATED');
    assert.equal(manager.hasUnsavedChanges('p'),false);assert.equal(manager.autosaveDirtyIds.size,0);
});

test('native window close finishes a stroke started while a pending manual save is awaited',async t=>{
    let release;const gate=new Promise(resolve=>release=resolve),writes=[];
    const {app,manager,layer,close}=fixture(t,async draft=>writes.push(draft));
    app.settingsManager={get:()=>true};manager.trackPendingSave(gate);
    const closing=close();await tick();
    app.tools.pointerSession={};layer.ctx.fillStyle='#0000ff';layer.ctx.fillRect(0,0,8,8);layer.invalidateSource(false);app.bus.emit('CANVAS_UPDATED');
    release();assert.deepEqual(await closing,{confirmClose:true});assert.equal(app.tools.pointerSession,null);
    const saved=PNG.sync.read(Buffer.from(writes.at(-1).project.layers[0].dataUrl.split(',')[1],'base64'));
    assert.deepEqual([...saved.data.slice(0,4)],[0,0,255,255]);assert.equal(manager.autosaveDirtyIds.size,0);
});

test('native window close retries recovery after a raw stroke begins during its previous write',async t=>{
    let app,layer;const writes=[];
    const state=fixture(t,async draft=>{
        writes.push(draft);
        if(writes.length===1){app.tools.pointerSession={};layer.ctx.fillStyle='#00ff00';layer.ctx.fillRect(0,0,8,8);layer.invalidateSource(false);app.bus.emit('CANVAS_UPDATED');}
    });({app,layer}=state);state.manager.queueAutosave('p');
    assert.deepEqual(await state.close(),{confirmClose:false});assert.equal(writes.length,2);assert.equal(app.tools.pointerSession,null);
    const saved=PNG.sync.read(Buffer.from(writes[1].project.layers[0].dataUrl.split(',')[1],'base64'));
    assert.deepEqual([...saved.data.slice(0,4)],[0,255,0,255]);assert.equal(state.manager.autosaveDirtyIds.size,0);
});

test('native close captures a newly edited tab after switching during recovery I/O',async t=>{
    let app;const writes=[];
    const state=fixture(t,async draft=>{
        writes.push(draft);
        if(writes.length===1){
            app.activeProjectId='other';app.config=app.projects[1].config;app.tools.pointerSession={};
            app.projects[1].layers[0].name='Edited while closing';app.bus.emit('CANVAS_UPDATED');
        }
    });({app}=state);
    const other={id:'other',draftId:'other',name:'Other',type:'canvas',config:{width:8,height:8},layers:[]};
    const layer=new Layer('second','Second',8,8);layer.canvas.toDataURL=()=>state.layer.canvas.toDataURL();other.layers=[layer];app.projects.push(other);
    app.layerManager.getLayers=()=>app.projects.find(project=>project.id===app.activeProjectId).layers;
    state.manager.markClean('other');state.manager.queueAutosave('p');t.after(()=>state.manager.releaseProject('other'));
    assert.deepEqual(await state.close(),{confirmClose:false});
    assert.equal(writes.at(-1).draftId,'other');assert.equal(writes.at(-1).project.layers[0].name,'Edited while closing');
    assert.equal(state.manager.autosaveDirtyIds.size,0);assert.equal(app.tools.pointerSession,null);
});

test('native close stops after bounded retries when editing continues during every disk write',async t=>{
    let app,layer,writes=0;const state=fixture(t,async()=>{
        writes++;app.tools.pointerSession={};layer.invalidateSource(false);app.bus.emit('CANVAS_UPDATED');
    });({app,layer}=state);state.manager.queueAutosave('p');
    assert.equal(await state.close(),false);assert.equal(writes,4);assert.equal(state.manager.autosaveDirtyIds.has('p'),true);
});

test('a queued Ctrl+S commits the gesture present when its turn starts',async t=>{
    let release;const gate=new Promise(resolve=>release=resolve),writes=[];
    const {app,manager,layer}=fixture(t,async()=>{});Object.assign(app.projects[0],{filePath:'C:/drawing.mlst',fileRevision:'a'.repeat(64)});
    window.desktopAPI.writeProjectFile=async(path,json)=>{writes.push(JSON.parse(json));if(writes.length===1)await gate;return 'b'.repeat(64);};
    manager.recordRecentSafely=()=>{};manager.refreshSavedProjectPreview=async()=>{};manager.finishSave=async()=>{};
    const first=manager.saveProject();await tick();const second=manager.saveProject();
    app.tools.pointerSession={};layer.ctx.fillStyle='#0000ff';layer.ctx.fillRect(0,0,8,8);layer.invalidateSource(false);app.bus.emit('CANVAS_UPDATED');
    release();assert.equal(await first,true);assert.equal(await second,true);assert.equal(writes.length,2);assert.equal(app.tools.pointerSession,null);
    const saved=PNG.sync.read(Buffer.from(writes[1].layers[0].dataUrl.split(',')[1],'base64'));
    assert.deepEqual([...saved.data.slice(0,4)],[0,0,255,255]);
});

test('queued Save As cannot write a snapshot when later pending input is invalid',async t=>{
    let release;const gate=new Promise(resolve=>release=resolve);let dialogs=0;
    const {app,manager}=fixture(t,async()=>{});manager.saveQueue=gate;
    window.desktopAPI.showSaveDialog=async()=>{dialogs++;return {canceled:true};};
    const pending=manager.saveProjectAs();app.tools.finishDocument=()=>false;release();
    assert.equal(await pending,false);assert.equal(dialogs,0);
});

test('native close refuses when input becomes invalid while a manual save is pending',async t=>{
    let release;const gate=new Promise(resolve=>release=resolve);let writes=0;
    const {app,manager,close}=fixture(t,async()=>{writes++;});manager.trackPendingSave(gate);
    const pending=close();await tick();app.tools.finishDocument=()=>false;release();
    assert.equal(await pending,false);assert.equal(writes,0);assert.equal(app.projects.length,1);
});

test('native close keeps the window open when both recovery stores fail',async t=>{
    const {app,manager,close}=fixture(t,async()=>{throw Error('ENOSPC');});
    localStorage.setItem=()=>{throw Error('Quota exceeded');};
    const warn=console.warn;console.warn=()=>{};t.after(()=>{console.warn=warn;});
    manager.queueAutosave('p');assert.equal(await close(),false);
    assert.equal(app.projects.length,1);assert.equal(manager.autosaveFailures.get('p'),true);assert.equal(manager.autosaveDirtyIds.has('p'),true);
});

test('saving rechecks pending input after asynchronous prefix or template preparation',async t=>{
    let release;const gate=new Promise(resolve=>release=resolve);let writes=0;
    const {app,manager}=fixture(t,async()=>{});Object.assign(app.projects[0],{filePath:'C:/drawing.mlst',prefixLoadPromise:gate});
    window.desktopAPI.writeFile=async()=>{writes++;};
    const pending=manager.saveProject();await tick();app.tools.finishDocument=()=>false;release(true);
    assert.equal(await pending,false);assert.equal(writes,0);
});
