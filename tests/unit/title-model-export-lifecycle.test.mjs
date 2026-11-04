import test from 'node:test';
import assert from 'node:assert/strict';
import TitleEditor from '../../src/renderer/js/ui/TitleEditor.js';

function fixture(api,name='Title'){
 const attributes=new Map(),button={disabled:false,setAttribute:(key,value)=>attributes.set(key,value),removeAttribute:key=>attributes.delete(key)},project={name,titleData:{}},notices=[];
 const editor={commitPendingEdit:()=>true,project:()=>project,panel:{querySelector:()=>button},renderer:{prepare(){},mesh:{modelBatches:[],nodes:[]},images:new Map()},app:{showToast:(message,type)=>notices.push(type)},viewport:{redraw(){}}};
 return {editor,button,attributes,notices,project,api};
}

test('BBModel export prevents duplicate dialogs and recovers after cancel and write failure',async()=>{
 const oldWindow=globalThis.window;let dialogs=0,writes=0,release;
 const api={showSaveDialog(){dialogs++;return new Promise(resolve=>release=resolve);},async writeFile(){writes++;throw Error('Expected write failure');}},f=fixture(api);
 try{
  globalThis.window={desktopAPI:api};const first=TitleEditor.prototype.exportModel.call(f.editor);
  assert.equal(f.button.disabled,true);assert.equal(f.attributes.get('aria-busy'),'true');
  assert.equal(await TitleEditor.prototype.exportModel.call(f.editor),false);assert.equal(dialogs,1);
  release({canceled:true});assert.equal(await first,false);assert.equal(writes,0);assert.equal(f.button.disabled,false);assert.equal(f.editor.exporting,false);assert.equal(f.attributes.has('aria-busy'),false);
  api.showSaveDialog=async()=>({canceled:false,filePath:'fixture.bbmodel'});
  assert.equal(await TitleEditor.prototype.exportModel.call(f.editor),false);assert.equal(writes,1);assert.equal(f.button.disabled,false);assert.equal(f.editor.exporting,false);assert.deepEqual(f.notices,['error']);
  api.writeFile=async()=>{writes++;};assert.ok(await TitleEditor.prototype.exportModel.call(f.editor));assert.equal(writes,2);assert.deepEqual(f.notices,['error','success']);
 }finally{release?.({canceled:true});if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;}
});

test('BBModel defaults use the common Windows-safe filename policy',async()=>{
 const oldWindow=globalThis.window;let options;
 try{
  globalThis.window={desktopAPI:{async showSaveDialog(value){options=value;return {canceled:true};}}};
  const f=fixture(globalThis.window.desktopAPI,'CON');assert.equal(await TitleEditor.prototype.exportModel.call(f.editor),false);assert.equal(options.defaultPath,'_CON.bbmodel');assert.equal(f.project.name,'CON');
 }finally{if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;}
});
