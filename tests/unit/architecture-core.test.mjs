import test from 'node:test';
import assert from 'node:assert/strict';
import {migrateProjectDocument} from '../../src/renderer/js/core/typed/ProjectMigrations.mjs';
import {readDocumentState} from '../../src/renderer/js/core/typed/DocumentState.mjs';
import {CommandRegistry} from '../../src/renderer/js/core/typed/CommandRegistry.mjs';
import {PerformanceJournal} from '../../src/renderer/js/core/typed/PerformanceJournal.mjs';
import {DocumentTasks} from '../../src/renderer/js/core/typed/DocumentTasks.mjs';
import {applyHistoryStep} from '../../src/renderer/js/core/typed/HistoryCursor.mjs';
import {recordFailure,performanceJournal,instrumentMethods} from '../../src/renderer/js/core/Performance.mjs';

test('project migration is pure, idempotent and preserves unknown metadata and pixel masters',()=>{
    const source={name:'old',width:32,height:64,custom:{keep:true},layers:[{id:'a',dataUrl:'png',sourceDataUrl:'original'}]},before=JSON.stringify(source),result=migrateProjectDocument(source);
    assert.equal(JSON.stringify(source),before);assert.equal(result.document.mollyVersion,2);assert.deepEqual(result.document.config,{width:32,height:64});assert.equal(result.document.layers[0].sourceDataUrl,'original');assert.deepEqual(result.steps,['1→2']);
    assert.deepEqual(migrateProjectDocument(result.document).document,result.document);
    for(const version of [0,-1,2.5,'bad',{},3])assert.throws(()=>migrateProjectDocument({...source,mollyVersion:version}));
});
test('document projection excludes interface and file-system state and copies mutable data',()=>{
    const source={type:'prefix',name:'A',config:{width:64,height:64},prefixData:{blocks:[{text:'A'}]},filePath:'private',undoStack:[1],zoom:20,panel:{}};
    const doc=readDocumentState(source);assert.equal(doc.filePath,undefined);assert.equal(doc.zoom,undefined);assert.equal(doc.undoStack,undefined);doc.prefixData.blocks[0].text='B';assert.equal(source.prefixData.blocks[0].text,'A');assert.throws(()=>readDocumentState({type:'model'}));
});
test('command registry respects guards, synchronous history and duplicate async requests',async()=>{
    let closing=false,count=0,release;const events=[],registry=new CommandRegistry(()=>({projectType:'canvas',closing}),event=>events.push(event));
    registry.register('undo',{run:()=>++count});assert.equal(registry.execute('undo'),1);
    registry.register('save',{exclusive:true,run:()=>new Promise(resolve=>{release=resolve;})});const first=registry.execute('save');assert.equal(registry.execute('save'),first);release(true);assert.equal(await first,true);
    closing=true;assert.equal(registry.execute('undo'),false);assert.equal(count,1);assert.throws(()=>registry.register('undo',{run:()=>{}}));assert.throws(()=>registry.execute('missing'));assert.equal(events.at(-1).state,'blocked');
});
test('document queue survives failure and refuses new work while closing',async()=>{
    const tasks=new DocumentTasks(),order=[];const first=tasks.run(async()=>{order.push(1);throw Error('failed');});const next=tasks.run(()=>order.push(2));await assert.rejects(first);await next;await tasks.idle();assert.deepEqual(order,[1,2]);assert.equal(tasks.pending.size,0);tasks.closing=true;await assert.rejects(tasks.run(()=>{}));
});

test('exclusive commands do not swallow a save after switching documents',async()=>{
    let projectId='a';const releases=[];
    const registry=new CommandRegistry(()=>({projectType:'canvas',projectId,closing:false}));
    registry.register('save',{exclusive:true,run:()=>new Promise(resolve=>releases.push(resolve))});
    const first=registry.execute('save');projectId='b';const second=registry.execute('save');
    assert.notEqual(first,second);assert.equal(registry.execute('save'),second);
    releases[0]('a');releases[1]('b');assert.deepEqual(await Promise.all([first,second]),['a','b']);
});

test('failed undo and redo retain the history cursor for a successful retry',()=>{
    let fail=true,value=1;const errors=[],command={undo(){if(fail)throw Error('retry');value--;},execute(){if(fail)throw Error('retry');value++;}};
    const undo=[command],redo=[];
    assert.equal(applyHistoryStep(undo,redo,true,e=>errors.push(e)),false);assert.deepEqual(undo,[command]);assert.deepEqual(redo,[]);
    fail=false;assert.equal(applyHistoryStep(undo,redo,true,e=>errors.push(e)),true);assert.equal(value,0);
    fail=true;assert.equal(applyHistoryStep(redo,undo,false,e=>errors.push(e)),false);assert.deepEqual(redo,[command]);
    fail=false;assert.equal(applyHistoryStep(redo,undo,false,e=>errors.push(e)),true);assert.equal(value,1);assert.equal(errors.length,2);
});

test('diagnostic errors include only allowlisted codes and record rejected async operations',async()=>{
    performanceJournal.clear();
    recordFailure('save',{code:'PRIVATE_PROJECT',name:'PRIVATE_PROJECT',message:'C:/PRIVATE_PROJECT/image.png'});
    recordFailure('save',{message:'ENOSPC: C:/PRIVATE_PROJECT/image.png'});
    const target={sync(){return 7;},async failed(){throw new TypeError('PRIVATE_PROJECT');}};
    instrumentMethods(target,['sync','failed'],'fixture');assert.equal(target.sync(),7);await assert.rejects(target.failed(),TypeError);
    const snapshot=performanceJournal.snapshot();assert.equal(JSON.stringify(snapshot).includes('PRIVATE_PROJECT'),false);
    assert.deepEqual(snapshot.events.map(e=>e.message),['Error','ENOSPC','TypeError']);assert.equal(snapshot.timings.length,2);
});
test('performance journal is bounded and its exported data cannot mutate stored samples',()=>{
    const journal=new PerformanceJournal();for(let i=0;i<1000;i++){journal.record('render',i);journal.event('error','TypeError');}journal.record('invalid',NaN);
    const result=journal.snapshot();assert.equal(result.events.length,80);assert.equal(result.timings[0].count,1000);assert.ok(result.timings[0].p95Ms>=990);result.timings[0].count=0;assert.equal(journal.snapshot().timings[0].count,1000);journal.clear();assert.deepEqual(journal.snapshot(),{timings:[],events:[]});
});
