const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,profile,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');
(async()=>{let win;const checks=[];try{
 await ready();win=makeWindow(1280,900);await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'title',name:'Title precision'}});await settle(win);
 const firstResult=await win.page.evaluate(async fixtureDirectory=>{
  const app=mollyEditor,e=app.titleEditor,r=e.renderer,p=app.getActiveProject(),checks=[],expect=(value,label)=>{if(!value)throw Error(label);checks.push(label);};await p.prefixLoadPromise;
  const bounds=canvas=>{const copy=Object.assign(document.createElement('canvas'),{width:canvas.width,height:canvas.height}),ctx=copy.getContext('2d',{willReadFrequently:true});ctx.drawImage(canvas,0,0);const pixels=ctx.getImageData(0,0,copy.width,copy.height).data;let minX=copy.width,minY=copy.height,maxX=-1,maxY=-1;for(let y=0;y<copy.height;y++)for(let x=0;x<copy.width;x++)if(pixels[(y*copy.width+x)*4+3]>=128){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}copy.width=copy.height=1;return {x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1};};
  for(const projection of ['perspective','orthographic'])for(const output of ['auto','square']){
   e.change(data=>Object.assign(data,{text:'MOLLY\nSTUDIO',projection,output,resolution:1024,yaw:18,pitch:-28,zoom:100,transforms:{}}));e.viewport.state.view='render';e.viewport.draw();
   const original={width:r.canvas.width,height:r.canvas.height,plan:r.lastPlan,pixels:r.canvas.toDataURL()},points=r.mesh.nodes.filter(n=>n.type==='glyph').map(n=>n.worldPivot),previewBounds=bounds(r.canvas);
   const result=r.render(p.titleData),nativeBounds=bounds(result.canvas),exportPlan=r.exportRenderer.lastPlan;
   expect(r.canvas.width===original.width&&r.canvas.height===original.height&&r.lastPlan===original.plan&&r.canvas.toDataURL()===original.pixels,projection+'/'+output+': exporting leaves the visible framebuffer and camera untouched');
   expect(Math.abs((previewBounds.width/previewBounds.height)/(nativeBounds.width/nativeBounds.height)-1)<.02,projection+'/'+output+': actual PNG and render preview retain the same letter proportions');
   for(const point of points){const visible=r.projectPoint(point),native=r.exportRenderer.projectPoint(point),plan=r.lastPlan,f=plan.frame;expect(Math.abs((visible[0]*plan.width-f.x)/f.width-native[0])<1e-8&&Math.abs((visible[1]*plan.height-f.y)/f.height-native[1])<1e-8,projection+'/'+output+': letter projection agrees inside the PNG frame');break;}
   const large=r.render(p.titleData,{scale:2});expect(large.canvas.width===result.canvas.width*2&&large.canvas.height===result.canvas.height*2&&r.exportRenderer.lastPlan.distance===exportPlan.distance,projection+'/'+output+': 2x export renders at native resolution with the identical camera');
   result.canvas.width=result.canvas.height=large.canvas.width=large.canvas.height=1;
  }
  let proof=null;
  const cropMask=(canvas,region,width,height)=>{const c=Object.assign(document.createElement('canvas'),{width,height}),ctx=c.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(canvas,region.x,region.y,region.width,region.height,0,0,width,height);const pixels=ctx.getImageData(0,0,width,height).data;c.width=c.height=1;return pixels;};
  for(const [text,yaw] of [['MINECRAFT',0],['МОЛЛИ\nSTUDIO',24.125]]){
   e.change(data=>Object.assign(data,{text,projection:'perspective',output:'auto',resolution:2048,yaw,pitch:-28,zoom:100,cameraTarget:[0,0,0],transforms:{}}));for(let i=0;e.loading&&i<500;i++)await new Promise(resolve=>setTimeout(resolve,20));e.viewport.state.view='edit';e.viewport.select(null);e.viewport.draw();
   const editing=Object.assign(document.createElement('canvas'),{width:r.canvas.width,height:r.canvas.height});editing.getContext('2d').drawImage(r.canvas,0,0);const editingBounds=bounds(editing),eye=r.lastPlan.distance;
   await app.exportPanel.open('project');const saved=await app.exportPanel.run();expect(!!saved,'The reference title saves through the real PNG dialog');app.exportPanel.dialog.close();
   const base64=await window.desktopAPI.readFile(fixtureDirectory+'/'+saved.file,'base64'),image=new Image();image.src='data:image/png;base64,'+base64;await image.decode();
   const png=Object.assign(document.createElement('canvas'),{width:image.width,height:image.height});png.getContext('2d').drawImage(image,0,0);const nativeBounds=bounds(png);
   expect(r.exportRenderer.lastPlan.distance===eye,text+': saved PNG keeps the editing camera eye distance');
   expect(Math.abs((editingBounds.width/editingBounds.height)/(nativeBounds.width/nativeBounds.height)-1)<.02,text+': saved PNG preserves the editing view letter aspect ratio');
   const width=640,height=Math.max(1,Math.round(width*nativeBounds.height/nativeBounds.width)),a=cropMask(editing,editingBounds,width,height),b=cropMask(png,nativeBounds,width,height);
   let intersection=0,union=0;for(let i=3;i<a.length;i+=4){if(a[i]>=96||b[i]>=96)union++;if(a[i]>=96&&b[i]>=96)intersection++;}
   expect(intersection/union>.94,text+': saved PNG silhouette matches the editing view, including left, middle and right letters ('+(intersection/union).toFixed(4)+')');
   if(text==='MINECRAFT'){
    const c=Object.assign(document.createElement('canvas'),{width:1200,height:480}),ctx=c.getContext('2d');ctx.fillStyle='#1f2023';ctx.fillRect(0,0,c.width,c.height);ctx.font='600 22px Segoe UI, sans-serif';ctx.fillStyle='#f1f1f1';ctx.fillText('В редакторе',30,34);ctx.fillText('Сохранённый PNG',30,274);
    for(const [source,region,y] of [[editing,editingBounds,54],[png,nativeBounds,294]]){const scale=Math.min(1140/region.width,160/region.height);ctx.drawImage(source,region.x,region.y,region.width,region.height,(1200-region.width*scale)/2,y+(160-region.height*scale)/2,region.width*scale,region.height*scale);}
    proof=c.toDataURL('image/png');c.width=c.height=1;
   }
   editing.width=editing.height=png.width=png.height=1;
  }
  e.change(data=>Object.assign(data,{text:'AB',projection:'perspective',output:'auto',resolution:1024,transforms:{}}));e.viewport.state.view='edit';e.viewport.resetCamera();e.viewport.draw();
  const id=r.mesh.nodes.find(n=>n.type==='glyph').id;e.viewport.select(id);e.viewport.draw();const hit=e.viewport.svg.querySelector('.title-axis-hit');e.viewport.draw();expect(hit===e.viewport.svg.querySelector('.title-axis-hit'),'Gizmo hit targets stay mounted between frames');
  const angle=e.panel.querySelector('[data-title-field="yaw"]');angle.value='18.125';angle.dispatchEvent(new Event('input',{bubbles:true}));angle.dispatchEvent(new Event('change',{bubbles:true}));expect(p.titleData.yaw===18.125&&e.viewport.state.yaw===18.125,'Camera fields update the same fractional angle used by editing and PNG');
  e.viewport.state.view='edit';e.viewport.draw();return {checks,proof};
 },profile);
 checks.push(...firstResult.checks);if(firstResult.proof)await fs.writeFile(path.join(root,'.test-output/title-camera-comparison.png'),Buffer.from(firstResult.proof.split(',')[1],'base64'));
 for(const axis of [0,1,2]){
  const start=await win.page.evaluate(()=>{const e=mollyEditor.titleEditor,id=e.renderer.mesh.nodes.find(n=>n.type==='glyph').id;e.viewport.state.mode='move';e.viewport.select(id);e.viewport.draw();return {id,pivot:e.viewport.node().worldPivot,transforms:JSON.stringify(mollyEditor.getActiveProject().titleData.transforms)};});await settle(win);
  const handle=await win.page.locator('.title-gizmo [data-title-axis="'+axis+'"] .title-axis-hit').boundingBox();if(!handle)throw Error('Missing axis '+axis);
  await win.page.keyboard.down('Shift');await win.page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await win.page.mouse.down();await win.page.mouse.move(handle.x+handle.width/2+32,handle.y+handle.height/2-17,{steps:4});await win.page.mouse.up();await win.page.keyboard.up('Shift');await settle(win);
  const delta=await win.page.evaluate(({id,pivot})=>{const node=mollyEditor.titleEditor.renderer.mesh.nodes.find(n=>n.id===id);return node.worldPivot.map((n,i)=>n-pivot[i]);},start);
  if(Math.abs(delta[axis])<.01||delta.some((n,i)=>i!==axis&&Math.abs(n)>.001)||Math.abs(delta[axis]*4-Math.round(delta[axis]*4))>.005)throw Error('Axis constraint or snap failed: '+JSON.stringify({axis,delta}));checks.push('Axis '+['X','Y','Z'][axis]+' constrains translation and Shift snaps to one source pixel');
  await win.page.evaluate(()=>mollyEditor.history.undo());await settle(win);
  if(await win.page.evaluate(()=>JSON.stringify(mollyEditor.getActiveProject().titleData.transforms))!==start.transforms)throw Error('Undo did not restore the constrained drag');checks.push('Undo restores the '+['X','Y','Z'][axis]+' gesture in one step');
 }
 const beforeCancel=await win.page.evaluate(()=>JSON.stringify(mollyEditor.getActiveProject().titleData.transforms)),handle=await win.page.locator('.title-gizmo [data-title-axis="0"] .title-axis-hit').boundingBox();
 await win.page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await win.page.mouse.down();await win.page.mouse.move(handle.x+handle.width/2+35,handle.y+handle.height/2+10);await win.page.keyboard.press('Escape');await win.page.mouse.up();await settle(win);
 if(await win.page.evaluate(()=>JSON.stringify(mollyEditor.getActiveProject().titleData.transforms))!==beforeCancel)throw Error('Escape did not cancel the gesture');checks.push('Escape cancels a drag without applying a transform');
 const cameraBeforePan=await win.page.evaluate(()=>structuredClone(mollyEditor.getActiveProject().titleData.cameraTarget));
 const area=await win.page.locator('.title-viewport-stage').boundingBox();await win.page.keyboard.down('Shift');await win.page.mouse.move(area.x+area.width*.6,area.y+area.height*.7);await win.page.mouse.down({button:'right'});await win.page.mouse.move(area.x+area.width*.6+30,area.y+area.height*.7-12,{steps:4});await win.page.mouse.up({button:'right'});await win.page.keyboard.up('Shift');await settle(win);
 if(!await win.page.evaluate(before=>{const e=mollyEditor.titleEditor,p=mollyEditor.getActiveProject();return JSON.stringify(p.titleData.cameraTarget)===JSON.stringify(e.viewport.state.target)&&p.titleData.cameraTarget.some((n,i)=>n!==before[i]);},cameraBeforePan))throw Error('Camera pan did not reach the document');checks.push('Panning commits the exact camera target used by PNG');
 await win.page.evaluate(()=>mollyEditor.history.undo());await settle(win);if(!await win.page.evaluate(before=>JSON.stringify(mollyEditor.titleEditor.viewport.state.target)===JSON.stringify(before),cameraBeforePan))throw Error('Camera undo did not restore the viewport');checks.push('Undo restores the shared camera and viewport pan together');
 const zoomBeforeWheel=await win.page.evaluate(()=>mollyEditor.getActiveProject().titleData.zoom);await win.page.mouse.wheel(0,-65);
 const flushed=await win.page.evaluate(async()=>{const a=mollyEditor;await a.exportPanel.open('project');const matches=a.getActiveProject().titleData.zoom===a.titleEditor.viewport.state.zoom&&a.exportPanel.context.titleData.zoom===a.getActiveProject().titleData.zoom;a.exportPanel.dialog.close();return matches;});if(!flushed)throw Error('Export used stale wheel zoom');checks.push('Opening export flushes the latest wheel gesture before its debounce timer');
 await win.page.evaluate(()=>mollyEditor.history.undo());await settle(win);if(await win.page.evaluate(()=>mollyEditor.titleEditor.viewport.state.zoom)!==zoomBeforeWheel)throw Error('Wheel zoom undo did not restore the shared camera');checks.push('Wheel navigation is committed and undone as one camera gesture');
 const exportSize=1024;
 const file=await win.page.evaluate(async exportSize=>{
  const editor=mollyEditor,{viewport,renderer}=editor.titleEditor,panel=editor.exportPanel;
  viewport.state.view='render';viewport.draw();
  const {width,height}=renderer.canvas,before=JSON.stringify(editor.getActiveProject().titleData);
  await panel.open('project');
  panel.get('titleResolution').value=String(exportSize);
  panel.get('titleOutput').value='square';panel.get('titlePadding').value='48';
  await panel.preview();
  if(panel.get('dimensions').textContent!==`${exportSize} × ${exportSize} px`)throw Error('Export preview does not show the selected PNG size');
  const result=await panel.run();if(!result)throw Error(panel.get('error').textContent);
  if(renderer.canvas.width!==width||renderer.canvas.height!==height)throw Error('Native export resized the viewport');
  if(JSON.stringify(editor.getActiveProject().titleData)!==before)throw Error('Native export modified the title document');
  panel.dialog.close();return result.file;
 },exportSize);
 const bytes=await fs.readFile(path.join(profile,file)),savedWidth=bytes.readUInt32BE(16),savedHeight=bytes.readUInt32BE(20);
 if(savedWidth!==exportSize||savedHeight!==exportSize)throw Error(`Expected a ${exportSize} px square, got ${savedWidth} × ${savedHeight} px`);
 checks.push('Native save writes the selected PNG dimensions without resizing the workspace');
 for(const size of [[1000,700],[1280,900],[1920,1080]]){win.setContentSize(...size);await settle(win);const fits=await win.page.evaluate(()=>{const e=mollyEditor.titleEditor,box=e.viewport.stage.getBoundingClientRect(),f=e.outputFrame||e.viewport.outputFrame;return !f.hidden&&f.getBoundingClientRect().left>=box.left-1&&f.getBoundingClientRect().right<=box.right+1&&document.documentElement.scrollWidth<=innerWidth;});if(!fits)throw Error('PNG frame overflow at '+size);checks.push('PNG frame fits the '+size.join('x')+' window');}
 await win.page.evaluate(()=>{const e=mollyEditor.titleEditor;e.viewport.state.view='edit';e.viewport.select(e.renderer.mesh.nodes.find(n=>n.type==='glyph').id);e.viewport.draw();});await settle(win);
 await fs.writeFile(path.join(root,'.test-output/title-precision.png'),(await win.webContents.capturePage()).toPNG());
 if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));await fs.writeFile(path.join(root,'.test-output/title-precision-report.json'),JSON.stringify({passed:true,checks},null,2));console.log(JSON.stringify({passed:checks.length,checks}));
}catch(error){console.error(error);process.exitCode=1;}finally{win?.destroy();app.exit(process.exitCode||0);}})();
