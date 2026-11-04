const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');
(async()=>{let win;try{
 await ready();win=makeWindow(1280,900);await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'title',name:'Title edge audit'}});await settle(win);
 const checks=await win.page.evaluate(async()=>{
  const a=mollyEditor,e=a.titleEditor,r=e.renderer;await a.getActiveProject().prefixLoadPromise;
  const checks=[],expect=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
  const originalLoad=r.loadFor.bind(r);let release;const gate=new Promise(resolve=>release=resolve);
  r.loadFor=async value=>{await gate;return originalLoad(value);};
  let p;
  try{
   a.addProject('Opening title','none',512,128,false,'title');p=a.getActiveProject();
   expect(Array.isArray(p.titleData.rows)&&!!p.titleData.transforms,'A newly opening title immediately has a normalized document');
   expect(e.panel.inert&&e.viewport.stage.inert&&e.commitPendingEdit()===false,'The inspector and viewport cannot edit a title while its initial resources are opening');
  }finally{release();r.loadFor=originalLoad;await p?.prefixLoadPromise;}
  expect(!e.panel.inert&&!e.viewport.stage.inert&&e.commitPendingEdit(),'Opening resources re-enables the complete editor');
  const stable=JSON.stringify(p.titleData);r.loadFor=async()=>{throw Error('Expected initial resource failure');};
  try{expect(await e.show(p)===false,'An initial resource error is reported as an unsuccessful open');}
  finally{r.loadFor=originalLoad;}
  expect(!e.panel.inert&&!e.viewport.stage.inert&&JSON.stringify(p.titleData)===stable,'An opening failure releases controls without changing the last complete title');
  const retry=e.panel.querySelector('[data-title-retry]');expect(!retry.hidden&&!retry.disabled,'An opening failure exposes a usable retry action');retry.click();for(let i=0;e.opening&&i<200;i++)await new Promise(resolve=>setTimeout(resolve,10));
  expect(retry.hidden&&!retry.disabled,'Retrying loads the document and removes the recovery action');
  await e.show(p);expect(e.panel.querySelector('.title-warning').textContent==='','Reopening a cached title clears the completed loading status');
  e.change(value=>{value.text='🚀';});const missingWarning=e.panel.querySelector('.title-warning').textContent;await e.show(p);
  expect(missingWarning.includes('🚀')&&e.panel.querySelector('.title-warning').textContent===missingWarning,'Reopening a cached title preserves the actual unsupported-character warning');
  e.change(value=>Object.assign(value,JSON.parse(stable)));e.setTab('scene');e.syncScene();
  const legacy=document.createElement('div');legacy.className='modal-overlay show';document.body.append(legacy);e.viewport.state.mode='move';e.viewport.stage.dispatchEvent(new KeyboardEvent('keydown',{key:'r',code:'KeyR',bubbles:true,cancelable:true}));expect(e.viewport.state.mode==='move','Legacy modal overlays also isolate the 3D keyboard shortcuts');legacy.remove();
  e.viewport.stage.dispatchEvent(new KeyboardEvent('keydown',{key:'r',code:'KeyR',isComposing:true,bubbles:true,cancelable:true}));expect(e.viewport.state.mode==='move','IME composition never changes the active 3D tool');
  const tree=e.panel.querySelector('.title-outliner'),first=tree.querySelector('[data-scene-node]'),id=first.dataset.sceneNode;
  const action=first.querySelector('[data-node-action="visible"]');action.focus();action.click();
  expect(tree.contains(document.activeElement)&&document.activeElement.closest('[data-scene-node]')?.dataset.sceneNode===id&&document.activeElement.dataset.nodeAction==='visible','Scene action buttons retain keyboard focus after the tree is rebuilt');
  a.history.undo();e.syncScene();
  expect(tree.querySelector('[role="treeitem"][tabindex="0"]'),'The scene tree has a keyboard entry point even before an object is selected');
  const row=tree.querySelector('[data-scene-node]');row.focus();row.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
  expect(e.viewport.state.selection!==id&&document.activeElement.dataset.sceneNode===e.viewport.state.selection,'Arrow Down selects and focuses the next visible scene object');
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));
  expect(e.viewport.state.selection===id,'Arrow Left returns from a collapsed child to its parent');
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));
  expect(document.activeElement===tree.lastElementChild,'End reaches the last visible scene object');
  const focusedBox=document.activeElement.getBoundingClientRect(),treeBox=tree.getBoundingClientRect();expect(focusedBox.top>=treeBox.top-1&&focusedBox.bottom<=treeBox.bottom+1,'Keyboard scene navigation scrolls the focused object into the visible tree');
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));
  expect(document.activeElement===tree.firstElementChild,'Home returns to the first scene object');
  e.viewport.select(r.mesh.nodes.find(node=>node.type==='glyph').id);e.viewport.state.expanded.delete(id);e.syncScene();expect(tree.firstElementChild.tabIndex===0,'Collapsing a selected descendant preserves a visible keyboard entry point');e.viewport.state.expanded.add(id);e.viewport.select(id);
  const angle=e.panel.querySelector('[data-title-field="yaw"]'),render=r.render.bind(r),beforeError={document:JSON.stringify(p.titleData),pixels:p.layers[0].canvas.toDataURL(),undo:a.history.undoStack.length};angle.focus();
  r.render=()=>{throw Error('Expected snapshot render failure');};
  try{angle.value=String(p.titleData.yaw+15);angle.dispatchEvent(new Event('input',{bubbles:true}));}
  finally{r.render=render;}
  angle.dispatchEvent(new Event('change',{bubbles:true}));
  expect(Number(angle.value)===p.titleData.yaw&&JSON.stringify(p.titleData)===beforeError.document&&p.layers[0].canvas.toDataURL()===beforeError.pixels&&a.history.undoStack.length===beforeError.undo,'A failed render restores the focused control without changing the last good pixels, document or history');
  e.viewport.select(r.mesh.nodes.find(node=>node.type==='glyph').id);const position=e.panel.querySelector('[data-title-transform="position"][data-axis="0"]');position.focus();const beforePosition=position.value;
  r.render=()=>{throw Error('Expected transform render failure');};
  try{position.value=String(Number(beforePosition)+3);position.dispatchEvent(new Event('input',{bubbles:true}));}
  finally{r.render=render;}
  position.dispatchEvent(new Event('change',{bubbles:true}));expect(position.value===beforePosition&&JSON.stringify(p.titleData)===beforeError.document,'A failed object transform also restores its focused numeric field');
  e.viewport.select(null);e.viewport.draw();const visible=r.canvas.toDataURL(),snapshot=JSON.stringify(p.titleData),extension=r.gl.getExtension('WEBGL_lose_context');
  expect(!!extension,'The graphics fixture supports real WebGL context loss');
  const lost=new Promise(resolve=>r.canvas.addEventListener('webglcontextlost',resolve,{once:true}));extension.loseContext();await lost;
  let rejected=false;try{r.prepare(p.titleData);}catch{rejected=true;}expect(rejected,'A lost WebGL context is rejected before rendering');
  const unavailableAngle=e.panel.querySelector('[data-title-field="yaw"]'),unavailablePixels=p.layers[0].canvas.toDataURL(),unavailableHistory=a.history.undoStack.length;unavailableAngle.focus();
  unavailableAngle.value=String(p.titleData.yaw+10);unavailableAngle.dispatchEvent(new Event('input',{bubbles:true}));unavailableAngle.dispatchEvent(new Event('change',{bubbles:true}));
  expect(JSON.stringify(p.titleData)===snapshot&&p.layers[0].canvas.toDataURL()===unavailablePixels&&a.history.undoStack.length===unavailableHistory&&Number(unavailableAngle.value)===p.titleData.yaw,'An edit during viewport context loss retains the last complete document, pixels and history');
  await new Promise(resolve=>setTimeout(resolve,50));const restored=new Promise(resolve=>r.canvas.addEventListener('webglcontextrestored',resolve,{once:true}));extension.restoreContext();await restored;e.viewport.draw();
  expect(JSON.stringify(p.titleData)===snapshot&&!r.lost&&r.canvas.toDataURL()===visible,'Restoring WebGL rebuilds the viewport without altering the title or its pixels');
  e.change(value=>{value.yaw+=10;});expect(p.titleData.yaw===JSON.parse(snapshot).yaw+10,'Editing works normally after the viewport context is restored');a.history.undo();e.viewport.draw();
  const image=r.render(p.titleData),png=image.canvas.toDataURL(),exporter=r.exportRenderer,exportExtension=exporter.gl.getExtension('WEBGL_lose_context');image.canvas.width=image.canvas.height=1;
  const exportLost=new Promise(resolve=>exporter.canvas.addEventListener('webglcontextlost',resolve,{once:true}));exportExtension.loseContext();await exportLost;
  rejected=false;try{r.render(p.titleData);}catch{rejected=true;}expect(rejected,'A lost export context fails safely without changing the visible viewport');
  await new Promise(resolve=>setTimeout(resolve,50));const exportRestored=new Promise(resolve=>exporter.canvas.addEventListener('webglcontextrestored',resolve,{once:true}));exportExtension.restoreContext();await exportRestored;
  const repeat=r.render(p.titleData);expect(repeat.canvas.toDataURL()===png&&r.canvas.toDataURL()===visible,'PNG rendering recovers independently and retains the exact output after context restoration');repeat.canvas.width=repeat.canvas.height=1;
  return checks;
 });
 if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));
 await fs.writeFile(path.join(root,'.test-output/title-edge-report.json'),JSON.stringify({passed:true,checks},null,2));console.log(JSON.stringify({passed:checks.length,checks}));
}catch(error){console.error(error);process.exitCode=1;}finally{win?.destroy();app.exit(process.exitCode||0);}})();
