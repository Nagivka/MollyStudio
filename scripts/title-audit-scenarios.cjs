const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');
(async()=>{let win;try{
 await ready();win=makeWindow(1280,900);await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'title',name:'Title audit'}});await settle(win);
 const result=await win.page.evaluate(async()=>{
  const a=mollyEditor,e=a.titleEditor,r=e.renderer,p=a.getActiveProject();await p.prefixLoadPromise;
  const {normalizeTitleDocument}=await import(new URL('js/core/TitleDocument.mjs',location.href));
  const {TITLE_MATERIAL_CATALOG}=await import(new URL('js/core/TitleMaterialCatalog.mjs',location.href));
  const checks=[],expect=(value,label)=>{if(!value)throw Error(label);checks.push(label);},tick=()=>new Promise(resolve=>setTimeout(resolve,10));
  const wait=async()=>{for(let i=0;e.loading&&i<500;i++)await tick();if(e.loading)throw Error('Title load did not finish');};
  const text=e.panel.querySelector('[data-title-field="text"]'),originalText=p.titleData.text;text.value='Щ'.repeat(65);text.dispatchEvent(new Event('input',{bubbles:true}));expect(p.titleData.text===originalText&&text.getAttribute('aria-invalid')==='true'&&e.commitPendingEdit()===false,'Text over the per-line limit remains editable and cannot be silently truncated or saved');text.value=originalText;text.dispatchEvent(new Event('input',{bubbles:true}));text.dispatchEvent(new Event('change',{bubbles:true}));await wait();
  const image=document.createElement('canvas');image.width=image.height=4;image.getContext('2d').fillRect(0,0,4,4);const uri=image.toDataURL();
  const before=structuredClone(p.titleData),slow=normalizeTitleDocument({...before,text:'SLOW',appearance:{source:'file',image:uri,fileMode:'tileable'}}),loadImage=r.loadImage.bind(r);
  let release,started=false;const gate=new Promise(resolve=>release=resolve);
  r.loadImage=async(asset,key)=>{if(asset===uri){started=true;await gate;}return loadImage(asset,key);};
  try{
   e.restoreSnapshot(p,slow);for(let i=0;!started&&i<100;i++)await tick();expect(started&&!!e.loading,'History can wait for an evicted material');
   e.restoreSnapshot(p,before);expect(!e.loading&&!e.viewport.stage.inert,'A newer cached history state immediately cancels the earlier loading state');
   release();await tick();await tick();expect(JSON.stringify(p.titleData)===JSON.stringify(before),'A late material result cannot overwrite the newer undo/redo state');
  }finally{release();r.loadImage=loadImage;}
  const bad='data:image/png;base64,AA==';r.loadImage=async(asset,key)=>{if(asset===bad)throw Error('Expected image load failure');return loadImage(asset,key);};
  try{e.restoreSnapshot(p,{...before,text:'FAIL',appearance:{source:'file',image:bad}});await wait();expect(JSON.stringify(p.titleData)===JSON.stringify(before)&&!e.viewport.stage.inert,'A failed history material load restores the last complete document');}finally{r.loadImage=loadImage;}
  a.history.clear();
  for(const word of ['FIRST','SECOND']){e.change(value=>Object.assign(value,before,{text:word,appearance:{source:'file',image:uri,fileMode:'tileable'}}));await wait();}
  e.change(value=>Object.assign(value,before,{text:'READY'}));await wait();const ready=JSON.stringify(p.titleData),undoCount=a.history.undoStack.length;
  r.images.delete(uri);r.loadImage=async(asset,key)=>{if(asset===uri){await tick();throw Error('Expected evicted material failure');}return loadImage(asset,key);};
  try{
   a.history.undo();a.history.undo();expect(e.panel.querySelector('.title-inspector-body').inert,'Dependent settings cannot edit a partially restored history state');
   await wait();expect(JSON.stringify(p.titleData)===ready&&a.history.undoStack.length===undoCount&&a.history.redoStack.length===0,'A failed chain of real undos restores both the last complete document and its history cursor');
  }finally{r.loadImage=loadImage;}
  a.history.undo();await wait();expect(p.titleData.text==='SECOND','A failed undo can be retried after its material becomes available');
  a.history.redo();await wait();expect(p.titleData.text==='READY'&&!e.panel.querySelector('.title-inspector-body').inert,'Redo and inspector controls recover after a failed asynchronous restore');
  e.restoreSnapshot(p,before);await wait();a.history.clear();
  e.openMaterialLibrary('fonts');const oldGallery=document.querySelector('.title-material-library'),staleChoice=oldGallery.querySelector('[data-title-library-item="block-serif"]');
  a.addProject('Gallery switch','none',512,128,false,'title');await a.getActiveProject().prefixLoadPromise;
  expect(!oldGallery.open,'Switching to another project closes the title resource library');
  const otherSnapshot=JSON.stringify(a.projectManager.serializeProject());staleChoice.click();
  expect(JSON.stringify(a.projectManager.serializeProject())===otherSnapshot,'A stale resource choice cannot modify the newly opened project');
  a.switchProject(p.id);await p.prefixLoadPromise;
  e.setTab('settings');a.menuBar.performAction('file-designs');expect(!e.panel.querySelector('.title-material-panel').hidden,'The designs menu reveals the appearance section before scrolling to its presets');
  a.menuBar.performAction('file-texture');expect(document.querySelector('.title-material-library[open]'),'The texture menu opens the actual title material chooser');const materialDialog=document.querySelector('.title-material-library');const materialClosed=new Promise(resolve=>materialDialog.addEventListener('close',resolve,{once:true}));materialDialog.close();await materialClosed;
  e.viewport.state.mode='move';e.openMaterialLibrary('fonts');const dialog=document.querySelector('.title-material-library'),close=dialog.querySelector('button.md-btn');close.focus();close.dispatchEvent(new KeyboardEvent('keydown',{key:'к',code:'KeyR',bubbles:true,cancelable:true}));expect(e.viewport.state.mode==='move','Scene keyboard shortcuts do not act through a modal gallery');
  const closed=new Promise(resolve=>dialog.addEventListener('close',resolve,{once:true}));dialog.close();await closed;e.viewport.stage.focus();e.viewport.stage.dispatchEvent(new KeyboardEvent('keydown',{key:'к',code:'KeyR',bubbles:true,cancelable:true}));expect(e.viewport.state.mode==='scale','Physical W/E/R shortcuts also work with the Russian keyboard layout');
  const eviction='qa-evicted-alpha';r.images.set(eviction,{width:8192,height:8192});r.alphaMaps.set(eviction,{});r.exportRenderer.alphaMaps.set(eviction,{});r.prepareMaterials(p.titleData);expect(!r.images.has(eviction)&&!r.alphaMaps.has(eviction)&&!r.exportRenderer.alphaMaps.has(eviction),'Image eviction releases matching alpha caches in both renderer instances');
  const texture=document.createElement('canvas');texture.width=texture.height=512;const ctx=texture.getContext('2d'),data=ctx.createImageData(512,512);let seed=17;
  for(let i=0;i<data.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data.data[i]=seed&255;data.data[i+1]=(seed>>>8)&255;data.data[i+2]=(seed>>>16)&255;data.data[i+3]=255;}ctx.putImageData(data,0,0);
  e.changeSettings(value=>{value.appearance={...value.appearance,source:'file',image:texture.toDataURL(),fileMode:'tileable'};});await wait();r.prepare(p.titleData);const buffers=r.batches.map(batch=>batch.buffer),time=performance.now();
  const command=a.history.undoStack.at(-1);expect(command.before&&command.after&&command.historyMemoryBytes>p.titleData.appearance.image.length,'History accounts for embedded image snapshots in its shared memory budget');
  for(let i=0;i<20;i++)r.prepare({...p.titleData,yaw:i,zoom:100+i});const cameraPrepareMs=(performance.now()-time)/20;
  expect(r.meshKey.length<4096&&buffers.every((buffer,i)=>r.batches[i].buffer===buffer),'Camera preparation keeps compact keys and reuses GPU buffers with a large embedded image');
  const sourcePixels=texture.width*texture.height;texture.width=texture.height=1;
  let tiles=0;
  for(const tileable of Object.keys(TITLE_MATERIAL_CATALOG.tileables)){
   const value={font:'minecraft-ten',text:'ЖЁЛТЫЙ',resolution:1024,appearance:{source:'tileable',tileable,randomRotation:true,randomMirror:true}};await r.loadFor(value);const output=r.render(value),pixels=output.canvas.getContext('2d').getImageData(0,0,output.canvas.width,output.canvas.height).data;
   if(output.missing.length||!pixels.some((n,i)=>i%4===3&&n>0))throw Error('Empty tileable material: '+tileable);output.canvas.width=output.canvas.height=1;tiles++;
  }
  expect(tiles===148,'All 148 tileable textures render with Cyrillic, deterministic rotation and mirroring');
  const maximum={font:'block-serif',text:Array(3).fill('Щ'.repeat(64)).join('\n'),layout:'stacked',resolution:1024};await r.loadFor(maximum);const large=r.render(maximum);expect(!large.missing.length&&r.exportRenderer.mesh.nodes.filter(n=>n.type==='glyph').length===192,'A maximum-length 192-letter Cyrillic title renders without losing glyphs');large.canvas.width=large.canvas.height=1;
  let rejected=false;try{r.render({...maximum,resolution:4096},{scale:16});}catch{rejected=true;}expect(rejected,'Oversized PNG output is rejected before allocating its framebuffer');
  r.prepare(p.titleData);
  e.viewport.state.mode='move';e.viewport.select(r.mesh.nodes.find(n=>n.type==='glyph').id);e.viewport.draw();
  return {checks,cameraPrepareMs,sourcePixels,tiles};
 });
 await settle(win);const handle=await win.page.locator('.title-gizmo [data-title-axis="0"] .title-axis-hit').boundingBox();if(!handle)throw Error('Missing move handle');const x=handle.x+handle.width/2,y=handle.y+handle.height/2;
 const beforeGesture=await win.page.evaluate(()=>({data:JSON.stringify(mollyEditor.getActiveProject().titleData),undo:mollyEditor.history.undoStack.length,redo:mollyEditor.history.redoStack.length}));
 await win.page.mouse.move(x,y);await win.page.mouse.down();await win.page.mouse.move(x+28,y,{steps:4});
 const cancelled=await win.page.evaluate(()=>{const e=mollyEditor.titleEditor,result=mollyEditor.history.undo();return {result,drag:!!e.viewport.drag,data:JSON.stringify(e.project().titleData),undo:mollyEditor.history.undoStack.length,redo:mollyEditor.history.redoStack.length};});
 await win.page.mouse.up();if(!cancelled.result||cancelled.drag||cancelled.data!==beforeGesture.data||cancelled.undo!==beforeGesture.undo||cancelled.redo!==beforeGesture.redo)throw Error('Undo cancelled a 3D gesture and also changed an older history step');result.checks.push('Undo cancels an active 3D pointer gesture without undoing the preceding command');
 await settle(win);await win.page.mouse.move(x,y);await win.page.mouse.down();await win.page.mouse.move(x+28,y,{steps:4});
 const committed=await win.page.evaluate(()=>{const e=mollyEditor.titleEditor;if(!e.drag&&!e.viewport.drag)throw Error('Gesture did not begin');const success=e.commitPendingEdit();return {success,drag:!!e.viewport.drag,transforms:JSON.stringify(e.project().titleData.transforms)};});
 await win.page.mouse.up();if(!committed.success||committed.drag||await win.page.evaluate(()=>JSON.stringify(mollyEditor.getActiveProject().titleData.transforms))!==committed.transforms)throw Error('Finishing a document during a gesture reverted the transform');result.checks.push('Saving or switching documents commits and releases the current axis gesture without a later rollback');
 if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));await fs.writeFile(path.join(root,'.test-output/title-audit-report.json'),JSON.stringify({passed:true,...result},null,2));console.log(JSON.stringify({passed:result.checks.length,...result}));
}catch(error){console.error(error);process.exitCode=1;}finally{win?.destroy();app.exit(process.exitCode||0);}})();
