import test from 'node:test';
import assert from 'node:assert/strict';
import EventBus from '../../src/renderer/js/core/EventBus.js';
import LayerManager from '../../src/renderer/js/graphics/LayerManager.js';
import ProjectManager from '../../src/renderer/js/core/ProjectManager.mjs';
import {installProjectOpenRequests} from '../../src/renderer/js/core/ProjectOpenRequests.js';
import {RasterCanvas} from '../helpers/raster-canvas.mjs';
import {pngData} from '../helpers/png.mjs';

function scope(t,key,value){const saved=globalThis[key];globalThis[key]=value;t.after(()=>{globalThis[key]=saved;});}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){for(let attempt=0;attempt<100;attempt++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('Asynchronous opening did not settle');}
function fixture(t){
    const canvases=[],decoded=[],reads=[],stored=new Map();
    scope(t,'document',{createElement:()=>{const canvas=new RasterCanvas();canvases.push(canvas);return canvas;},addEventListener(){},removeEventListener(){}});
    scope(t,'Image',class{
        width=8;height=8;naturalWidth=8;naturalHeight=8;data=new Uint8ClampedArray(8*8*4).fill(255);
        set src(value){decoded.push(this);queueMicrotask(()=>this.onload());}
    });
    scope(t,'localStorage',{getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)});
    scope(t,'sessionStorage',{getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)});
    scope(t,'location',{search:'?file=dragged.mlst&source=session'});
    const input={type:'canvas',name:'Imported',config:{width:8,height:8},layers:[{id:'pixel',width:8,height:8,dataUrl:pngData(8,8)}]};
    scope(t,'window',{desktopAPI:{readFile:async path=>{reads.push(path);return JSON.stringify(input);}}});
    const bus=new EventBus(),layers=new LayerManager(bus,{width:8,height:8});
    const previous={id:'old',name:'Existing',type:'canvas',layers:[],config:{width:8,height:8}};
    const app={projects:[previous],activeProjectId:'old',config:{width:8,height:8},layerManager:layers,bus,allow:true,created:0,
        tools:{finishDocument:()=>app.allow},showToast(){},renderTabs(){},
        saveProjectState(){const project=this.projects.find(item=>item.id===this.activeProjectId);if(project){project.layers=[...layers.layers];project.config={...this.config};}},
        addProject(name,template,width,height,frame,type,bg){
            if(!this.allow)return;this.saveProjectState();
            const project={id:`new-${++this.created}`,draftId:`draft-${this.created}`,name,type,bg,layers:[],config:{width,height}};
            this.projects.push(project);this.activeProjectId=project.id;this.config={...project.config};layers.clearLayers();
        },
        loadProjectState(id){const project=this.projects.find(item=>item.id===id);this.activeProjectId=id;this.config={...project.config};layers.setLayers([...project.layers]);},
        switchProject(id){if(this.allow){this.saveProjectState();this.loadProjectState(id);}}
    };
    const manager=new ProjectManager(app);manager.flushAutosaves=async()=>true;manager.markClean('old');
    t.after(()=>{for(const project of app.projects)manager.releaseProject(project.id);});
    return {app,manager,canvases,decoded,reads,stored,input,previous};
}

test('native opening after a session import reads disk despite the original launcher URL',async t=>{
    const {manager,app,reads,stored,input}=fixture(t);
    stored.set('molly_pending_project',JSON.stringify(input));
    assert.equal(await manager.openRecentProject('dragged.mlst',{fromSession:true}),true);
    assert.equal(stored.has('molly_pending_project'),false);assert.equal(reads.length,0);
    assert.equal(app.projects.at(-1).filePath,'');
    assert.equal(await manager.openRecentProject('C:/disk.mlst'),true);
    assert.deepEqual(reads,['C:/disk.mlst']);assert.equal(app.projects.at(-1).filePath,'C:/disk.mlst');
    assert.equal(app.projects.length,3);
});

test('simultaneous dialog and native opens share one read, decode and project tab',async t=>{
    const {manager,app,reads,decoded}=fixture(t);let release;
    window.desktopAPI.readFile=path=>{reads.push(path);return new Promise(resolve=>{release=resolve;});};
    window.desktopAPI.showOpenDialog=async()=>({canceled:false,filePaths:['c:\\PROJECTS\\test.mlst']});
    const external=manager.openRecentProject('C:/projects/Test.mlst');const dialog=manager.openProject();await tick();
    assert.equal(reads.length,1);release(JSON.stringify({type:'canvas',config:{width:8,height:8},layers:[{id:'a',dataUrl:pngData(8,8)}]}));
    assert.equal(await external,true);assert.equal(await dialog,true);
    assert.equal(app.created,1);assert.equal(decoded.length,1);assert.equal(app.projects.length,2);assert.equal(manager.openFilesInFlight.size,0);
});

test('a deferred session import retains its source and frees prepared pixels before retry',async t=>{
    const {manager,app,stored,input,canvases}=fixture(t);stored.set('molly_pending_project',JSON.stringify(input));
    let allowed=0;app.tools.finishDocument=()=>++allowed<2||app.allow;app.allow=false;
    assert.deepEqual(await manager.openRecentProject('dragged.mlst',{fromSession:true}),{deferred:true});
    assert.equal(app.projects.length,1);assert.equal(stored.has('molly_pending_project'),true);
    assert.ok(canvases.every(canvas=>canvas.width===1&&canvas.height===1));
    app.allow=true;assert.equal(await manager.openRecentProject('dragged.mlst',{fromSession:true}),true);
    assert.equal(app.projects.length,2);assert.equal(stored.has('molly_pending_project'),false);
});

test('a native request blocked after decoding remains queued and opens after input is corrected',async t=>{
    const {manager,app,canvases}=fixture(t),requests=[{id:7,path:'C:/loaded.mlst'}],acked=[];let notifying;
    window.desktopAPI.getPendingProjectOpens=async()=>requests.slice();
    window.desktopAPI.acknowledgeProjectOpen=async id=>{acked.push(id);requests.splice(0,1);};
    window.desktopAPI.onProjectOpenRequested=callback=>{notifying=callback;return()=>{notifying=null;};};
    let calls=0;app.tools.finishDocument=()=>++calls<2||app.allow;app.allow=false;
    const dispose=installProjectOpenRequests({manager});t.after(dispose);await until(()=>calls>=2&&manager.openFilesInFlight.size===0);
    assert.equal(app.created,0);assert.deepEqual(acked,[]);assert.equal(requests.length,1);
    assert.ok(canvases.every(canvas=>canvas.width===1&&canvas.height===1));
    app.allow=true;app.bus.emit('HISTORY_CHANGED');await until(()=>acked.length===1);
    assert.deepEqual(acked,[7]);assert.equal(app.created,1);assert.equal(requests.length,0);assert.equal(typeof notifying,'function');
});

test('a tab creation refused after staging frees all images and permits a later retry',async t=>{
    const {manager,app,input,canvases}=fixture(t),add=app.addProject;
    app.addProject=()=>{};
    await assert.rejects(manager.deserializeProject(input),error=>error.code==='PROJECT_OPEN_DEFERRED');
    assert.equal(app.projects.length,1);assert.ok(canvases.every(canvas=>canvas.width===1&&canvas.height===1));
    app.addProject=add;assert.ok(await manager.deserializeProject(input));assert.equal(app.created,1);
});

test('an edit committed after the last import flush remains queued for the previous document',async t=>{
    const {manager,app,input,previous}=fixture(t);
    manager.flushAutosaves=async()=>{previous.name='Edited during disk I/O';return true;};
    assert.ok(await manager.deserializeProject(input));assert.notEqual(app.activeProjectId,previous.id);
    assert.equal(manager.autosaveDirtyIds.has(previous.id),true);assert.equal(manager.getRevision(previous.id),1);
    assert.equal(previous.name,'Edited during disk I/O');
});

test('recent-project storage failure cannot turn a successful file open into an error',async t=>{
    const {manager,app}=fixture(t),warn=console.warn;t.after(()=>{console.warn=warn;});console.warn=()=>{};
    localStorage.setItem=()=>{throw Error('Quota exceeded');};
    assert.equal(await manager.openRecentProject('C:/opened.mlst'),true);assert.equal(app.created,1);
    assert.equal(app.projects.at(-1).filePath,'C:/opened.mlst');
});

test('restoring a crash draft marks and backs up the restored project after an intervening tab switch',async t=>{
    const {manager,app,input}=fixture(t),saved=[];
    window.desktopAPI.readRecoveryDraft=async()=>({draftId:'restored',timestamp:1,hasChanges:true,project:input});
    const deserialize=manager.deserializeProject.bind(manager);let restored;
    manager.deserializeProject=async(...args)=>{
        restored=await deserialize(...args);app.addProject('Other','none',8,8,false,'canvas','transparent');return restored;
    };
    manager.performAutosave=async id=>{saved.push(id);return true;};
    assert.equal(await manager.restoreCrashDraft('restored'),true);
    assert.notEqual(app.activeProjectId,restored.id);assert.deepEqual(saved,[restored.id]);
    assert.equal(manager.autosaveDirtyIds.has(app.activeProjectId),false);assert.equal(restored.draftId,'restored');
});

for(const stage of ['create','load','tabs'])test(`failed document installation during ${stage} removes its provisional tab and restores the previous project`,async t=>{
    const {manager,app,input,previous,canvases}=fixture(t);
    const add=app.addProject,load=app.loadProjectState;let failed=false;
    if(stage==='create')app.addProject=function(...args){add.apply(this,args);throw Error('Create failed');};
    if(stage==='load')app.loadProjectState=function(id){if(id!==previous.id)throw Error('Load failed');return load.call(this,id);};
    if(stage==='tabs')app.renderTabs=()=>{if(!failed){failed=true;throw Error('Tabs failed');}};
    await assert.rejects(manager.deserializeProject(input),new RegExp(stage,'i'));
    assert.deepEqual(app.projects,[previous]);assert.equal(app.activeProjectId,previous.id);
    assert.deepEqual(app.layerManager.getLayers(),previous.layers);assert.equal(manager.autosaveSuppressed,false);
    assert.ok(canvases.every(canvas=>canvas.width===1&&canvas.height===1));
    assert.ok([...manager.documentFingerprints.keys()].every(id=>id===previous.id));
});
