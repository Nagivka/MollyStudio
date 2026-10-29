import test from 'node:test';
import assert from 'node:assert/strict';
import EventBus from '../../src/renderer/js/core/EventBus.js';
import History from '../../src/renderer/js/core/History.js';
import ProjectManager from '../../src/renderer/js/core/ProjectManager.mjs';
import LayerManager from '../../src/renderer/js/graphics/LayerManager.js';
import Tool from '../../src/renderer/js/tools/Tool.js';
import {LayerPropertyCommand,TextDataCommand} from '../../src/renderer/js/core/Commands.js';
import {RasterCanvas} from '../helpers/raster-canvas.mjs';

function scene(t) {
    const previous={document:globalThis.document,window:globalThis.window,localStorage:globalThis.localStorage};
    globalThis.document={getElementById:()=>null,createElement:()=>new RasterCanvas()};globalThis.window={addEventListener(){}};
    globalThis.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
    t.after(()=>Object.assign(globalThis,previous));
    const bus=new EventBus(),layers=new LayerManager(bus,{width:8,height:8}),history=new History(bus),layer=layers.addLayer('Pixels');
    const project={id:'p',draftId:'p',type:'canvas',name:'Saved',filePath:'C:/saved.mlst',config:{width:8,height:8},layers:[layer]};
    const app={bus,projects:[project],activeProjectId:'p',config:project.config,layerManager:layers,history,tools:{tools:{}}};
    const manager=new ProjectManager(app),tool=new Tool(bus,layers,history);manager.initAutosave();manager.markClean('p');manager.markSaved('p');
    t.after(()=>manager.releaseProject('p'));
    const paint=color=>{const before=layer.getImageData();layer.ctx.fillStyle=color;layer.ctx.fillRect(0,0,8,8);layer.invalidateSource(false);tool.commitRasterEdit(layer,before);};
    return {app,bus,layers,history,layer,project,manager,paint};
}

test('undo returns a bitmap to its saved state without rewinding renderer cache revisions',t=>{
    const {layer,history,manager,paint}=scene(t);paint('#ff0000');const editedRevision=layer.contentRevision;
    assert.equal(manager.hasUnsavedChanges('p'),true);history.undo();
    assert.ok(layer.contentRevision>editedRevision);assert.equal(manager.hasUnsavedChanges('p'),false);
    history.redo();assert.equal(manager.hasUnsavedChanges('p'),true);
});

test('redo returns to a save point created after drawing and a new branch remains modified',t=>{
    const {history,manager,paint}=scene(t);paint('#ff0000');manager.markSaved('p');
    history.undo();assert.equal(manager.hasUnsavedChanges('p'),true);
    history.redo();assert.equal(manager.hasUnsavedChanges('p'),false);
    history.undo();paint('#0000ff');assert.equal(manager.hasUnsavedChanges('p'),true);assert.equal(history.canRedo(),false);
});

test('undoing an object property returns to the save point too',t=>{
    const {bus,layer,history,manager}=scene(t),command=new LayerPropertyCommand(layer,'opacity',1,.5,bus);
    command.execute();history.push(command);assert.equal(manager.hasUnsavedChanges('p'),true);
    history.undo();assert.equal(manager.hasUnsavedChanges('p'),false);history.redo();assert.equal(manager.hasUnsavedChanges('p'),true);
});

test('editable text compares its model while rendering caches continue to advance',t=>{
    const {bus,layer,history,manager}=scene(t);layer.type='text';layer.textData={text:'A',fontId:'minecraft',x:0,y:0};
    manager.markClean('p');manager.markSaved('p');bus.on('RENDER_TEXT_LAYER',()=>layer.invalidateSource());
    const command=new TextDataCommand(layer,layer.textData,{...layer.textData,text:'B'},bus);
    command.execute();history.push(command);assert.equal(manager.hasUnsavedChanges('p'),true);
    history.undo();assert.equal(manager.hasUnsavedChanges('p'),false);history.redo();assert.equal(manager.hasUnsavedChanges('p'),true);
});

test('saving an earlier snapshot does not label edits made during the write as saved',async t=>{
    const {manager,paint,history}=scene(t);paint('#ff0000');const revision=manager.getRevision('p'),fingerprint=manager.getDocumentFingerprint('p');
    paint('#0000ff');await manager.finishSave('p',revision,fingerprint);
    assert.equal(manager.hasUnsavedChanges('p'),true);
    history.undo();assert.equal(manager.hasUnsavedChanges('p'),false);
});

test('a stroke without a history event cannot clear the recovery copy of newer pixels',async t=>{
    const {manager,layer,paint}=scene(t),deleted=[];paint('#ff0000');
    const revision=manager.getRevision('p'),fingerprint=manager.getDocumentFingerprint('p');
    window.desktopAPI={deleteRecoveryDraft:async id=>deleted.push(id)};
    layer.ctx.fillStyle='#0000ff';layer.ctx.fillRect(0,0,8,8);layer.invalidateSource(false);
    assert.equal(manager.getRevision('p'),revision);
    assert.equal(await manager.finishSave('p',revision,fingerprint),false);
    assert.deepEqual(deleted,[]);assert.equal(manager.hasUnsavedChanges('p'),true);
    assert.equal(manager.autosaveDirtyIds.has('p'),true);
});

test('pixels edited during asynchronous recovery deletion remain dirty even without a history event',async t=>{
    const {manager,layer,paint}=scene(t);paint('#ff0000');
    const revision=manager.getRevision('p'),fingerprint=manager.getDocumentFingerprint('p');
    window.desktopAPI={deleteRecoveryDraft:async()=>{layer.ctx.fillStyle='#0000ff';layer.ctx.fillRect(0,0,8,8);layer.invalidateSource(false);}};
    assert.equal(await manager.finishSave('p',revision,fingerprint),false);
    assert.equal(manager.hasUnsavedChanges('p'),true);assert.equal(manager.autosaveDirtyIds.has('p'),true);
});

test('recovery state tracking does not require PNG encoding to inspect the save point',t=>{
    const {layer,manager,history,paint}=scene(t);layer.canvas.toDataURL=()=>assert.fail('Save status must not encode PNG');
    paint('#ff0000');history.undo();assert.equal(manager.hasUnsavedChanges('p'),false);
});

test('prefix save points compare editable parameters instead of freshly generated pixels',t=>{
    const {project,layer,manager,bus}=scene(t);project.type='prefix';project.prefixData={blocks:[{text:'VIP'}]};layer.objectType='prefix';
    manager.markClean('p');manager.markSaved('p');
    project.prefixData={blocks:[{text:'ADMIN'}]};layer.invalidateSource();bus.emit('CANVAS_UPDATED');assert.equal(manager.hasUnsavedChanges('p'),true);
    project.prefixData={blocks:[{text:'VIP'}]};layer.invalidateSource();bus.emit('CANVAS_UPDATED');assert.equal(manager.hasUnsavedChanges('p'),false);
});

test('a restored draft is still unsaved even though its imported pixels establish the initial state',async t=>{
    const {project,manager}=scene(t);project.filePath='';
    window.desktopAPI={readRecoveryDraft:async()=>({draftId:'restored',project:{name:'Recovered',layers:[]}})};
    manager.deserializeProject=async()=>project;manager.performAutosave=async()=>true;
    assert.equal(await manager.restoreCrashDraft('restored'),true);assert.equal(manager.hasUnsavedChanges('p'),true);
});

test('returning a disk-backed project to its save point removes the obsolete recovery copy',async t=>{
    const {manager,history,paint,layer}=scene(t),deleted=[];
    window.desktopAPI={deleteRecoveryDraft:async id=>deleted.push(id),writeRecoveryDraft:async()=>assert.fail('Clean saved pixels do not need a new recovery file')};
    paint('#ff0000');history.undo();layer.canvas.toDataURL=()=>assert.fail('Clean autosave must not encode PNG');
    assert.equal(await manager.performAutosave('p'),true);assert.deepEqual(deleted,['p']);assert.equal(manager.autosaveDirtyIds.size,0);
});
