import test from 'node:test';
import assert from 'node:assert/strict';
import TitleEditor from '../../src/renderer/js/ui/TitleEditor.js';

test('a delayed artwork import cannot move to another row or project',()=>{
 const originalDocument=globalThis.document,originalReader=globalThis.FileReader;
 let reader,active={},applied=0,last;
 const input=()=>({files:[{type:'image/png',size:64}],addEventListener(_event,listener){this.changed=listener;},click(){this.changed();}});
 try{
  globalThis.document={createElement:()=>input()};
  globalThis.FileReader=class{constructor(){reader=this;this.result='data:image/png;base64,AAAA';}readAsDataURL(){}};
  const editor={project:()=>active,currentRow:-1,commitPendingEdit:()=>true,app:{showToast(){assert.fail('Valid import should not report an error');}},changeSettings(fn){last={appearance:{}};fn(last);applied++;}};
  TitleEditor.prototype.importArtwork.call(editor,'image');editor.currentRow=1;reader.onload();assert.equal(applied,0);
  TitleEditor.prototype.importArtwork.call(editor,'image');active={};reader.onload();assert.equal(applied,0);
  TitleEditor.prototype.importArtwork.call(editor,'image');reader.onload();assert.equal(applied,1);assert.equal(last.appearance.image,reader.result);
 }finally{
  if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;
  if(originalReader===undefined)delete globalThis.FileReader;else globalThis.FileReader=originalReader;
 }
});
