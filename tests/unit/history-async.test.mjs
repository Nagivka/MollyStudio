import test from 'node:test';
import assert from 'node:assert/strict';
import History from '../../src/renderer/js/core/History.js';

const make=()=>new History({on(){},emit(){}});
test('a failed asynchronous undo or redo retains its command for retry',()=>{
 const h=make();let pending;
 const command={undo(){pending=h.trackRestore(command,true);},execute(){pending=h.trackRestore(command,false);}};
 h.push(command);assert.equal(h.undo(),true);assert.deepEqual(h.redoStack,[command]);assert.equal(pending.rollback(),true);
 assert.deepEqual(h.undoStack,[command]);assert.deepEqual(h.redoStack,[]);
 h.undo();h.redo();assert.equal(pending.rollback(),true);assert.deepEqual(h.undoStack,[]);assert.deepEqual(h.redoStack,[command]);
});
test('a failed chain of restores returns to the last fully rendered history position',()=>{
 const h=make();let pending;
 const command=()=>{const c={undo(){pending=h.trackRestore(c,true,pending?.checkpoint);},execute(){}};return c;};
 const first=command(),second=command();h.push(first);h.push(second);h.undo();h.undo();
 assert.deepEqual(h.undoStack,[]);assert.equal(pending.rollback(),true);assert.deepEqual(h.undoStack,[first,second]);assert.deepEqual(h.redoStack,[]);
});
test('a stale restore cannot replace a new edit; a background project repairs only its own cursor',()=>{
 const h=make();let pending;const c={undo(){pending=h.trackRestore(c,true);},execute(){}};h.push(c);h.undo();
 const newer={undo(){},execute(){}};h.push(newer);assert.equal(pending.rollback(),false);assert.deepEqual(h.undoStack,[newer]);
 h.clear();h.push(c);h.undo();const old=h.state,active={undoStack:[newer],redoStack:[]};h.bindState(active);
 assert.equal(pending.rollback(),true);assert.deepEqual(old.undoStack,[c]);assert.equal(h.state,active);assert.deepEqual(h.undoStack,[newer]);
});

test('undo cancels an active 3D gesture without undoing an older command',()=>{
 const previous=globalThis.window,h=make();let calls=0,cancelled=0;const p={},viewport={drag:{},cancelDrag(){this.drag=null;cancelled++;}};
 try{
  globalThis.window={mollyEditor:{titleEditor:{project:()=>p,viewport}}};h.push({undo(){calls++;},execute(){}});
  assert.equal(h.undo(),true);assert.equal(cancelled,1);assert.equal(calls,0);assert.equal(h.undoStack.length,1);
 }finally{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});
test('undo cancels a wheel gesture before its debounce without losing an older step',()=>{
 const previous=globalThis.window,h=make(),p={},before={yaw:7};let restored;const viewport={cameraDirty:true},title={project:()=>p,viewport,pending:{project:p,before},safeApply(_p,value){restored=value;},sync(){}};
 try{
  globalThis.window={mollyEditor:{titleEditor:title}};h.push({undo(){assert.fail('Older command must remain applied');},execute(){}});
  assert.equal(h.undo(),true);assert.equal(restored,before);assert.equal(viewport.cameraDirty,false);assert.equal(title.pending,null);assert.equal(h.undoStack.length,1);
 }finally{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});
