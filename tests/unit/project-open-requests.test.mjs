import test from 'node:test';
import assert from 'node:assert/strict';
import {installProjectOpenRequests} from '../../src/renderer/js/core/ProjectOpenRequests.js';
import EventBus from '../../src/renderer/js/core/EventBus.js';
import ProjectManager from '../../src/renderer/js/core/ProjectManager.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,requests){
    const originalWindow=globalThis.window,originalLocation=globalThis.location;
    let listener;const acknowledgements=[],navigations=[];
    globalThis.window={desktopAPI:{getPendingProjectOpens:async()=>requests.slice(),acknowledgeProjectOpen:async id=>{acknowledgements.push(id);requests.splice(requests.findIndex(item=>item.id===id),1);},onProjectOpenRequested:callback=>{listener=callback;return()=>listener=null;}}};
    globalThis.location={replace:url=>navigations.push(url)};
    t.after(()=>{globalThis.window=originalWindow;globalThis.location=originalLocation;});
    return {acknowledgements,navigations,notify:()=>listener?.()};
}
test('launcher navigation retains the native request until the editor acknowledges it',async t=>{
    const requests=[{id:1,path:'C:/Проект.mlst'}],state=fixture(t,requests);
    const dispose=installProjectOpenRequests({launcher:true});await tick();
    assert.deepEqual(state.navigations,['editor.html?external=true']);assert.equal(requests.length,1);assert.equal(state.acknowledgements.length,0);dispose();
});
test('new native requests arriving during a load are processed once in order',async t=>{
    const requests=[{id:1,path:'one.mlst'}],state=fixture(t,requests),opened=[];
    let release;const gate=new Promise(resolve=>release=resolve);
    const dispose=installProjectOpenRequests({manager:{openRecentProject:async path=>{opened.push(path);if(path==='one.mlst')await gate;}}});
    await tick();requests.push({id:2,path:'two.mlst'});state.notify();release();await tick();await tick();
    assert.deepEqual(opened,['one.mlst','two.mlst']);assert.deepEqual(state.acknowledgements,[1,2]);assert.equal(requests.length,0);dispose();
});
test('a disposed page cannot acknowledge or load a pending project',async t=>{
    const requests=[{id:1,path:'one.mlst'}],state=fixture(t,requests);let opened=false;
    const dispose=installProjectOpenRequests({manager:{openRecentProject:async()=>opened=true}});dispose();await tick();
    assert.equal(opened,false);assert.equal(requests.length,1);assert.deepEqual(state.acknowledgements,[]);
});

test('native file opening waits for a valid document and retries without dropping requests',async t=>{
    const requests=[{id:1,path:'one.mlst'},{id:2,path:'two.mlst'}],state=fixture(t,requests),bus=new EventBus(),opened=[];
    let blocked=true;
    const dispose=installProjectOpenRequests({manager:{app:{bus},openRecentProject:async path=>{if(blocked)return {deferred:true};opened.push(path);return true;}}});
    await tick();assert.deepEqual(state.acknowledgements,[]);assert.equal(requests.length,2);
    blocked=false;bus.emit('HISTORY_CHANGED');await tick();await tick();
    assert.deepEqual(opened,['one.mlst','two.mlst']);assert.deepEqual(state.acknowledgements,[1,2]);dispose();
    assert.equal(bus.listeners.size,0);
});

test('a page disposed during asynchronous opening leaves the request unacknowledged',async t=>{
    const requests=[{id:1,path:'one.mlst'}],state=fixture(t,requests);let release;
    const dispose=installProjectOpenRequests({manager:{openRecentProject:()=>new Promise(resolve=>release=resolve)}});
    await tick();dispose();release(true);await tick();
    assert.equal(requests.length,1);assert.deepEqual(state.acknowledgements,[]);
});

test('an invalid editor draft defers opening before reading a file or creating another tab',async t=>{
    let reads=0;const oldWindow=globalThis.window;t.after(()=>{globalThis.window=oldWindow;});
    globalThis.window={desktopAPI:{readFile:()=>{reads++;}}};
    const project={id:'a',filePath:'C:/a.mlst'},app={projects:[project],activeProjectId:'a',tools:{finishDocument:()=>false},showToast(){}};
    const manager=new ProjectManager(app);
    assert.deepEqual(await manager.openRecentProject('C:/b.mlst'),{deferred:true});assert.equal(reads,0);assert.equal(app.projects.length,1);
});

test('a blocked tab switch is never reported as a successful focus',()=>{
    const manager=new ProjectManager({projects:[{id:'a'},{id:'b',filePath:'C:/b.mlst'}],activeProjectId:'a',switchProject(){}});
    assert.equal(manager.focusOpenFile('c:\\B.mlst'),false);
});
