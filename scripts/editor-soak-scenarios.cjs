const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');
(async()=>{let win;const timer=setTimeout(()=>app.exit(1),240000);try{
 await ready();win=makeWindow();await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'canvas',width:'32',height:'32',name:'Soak anchor'}});
 const samples=[];
 for(let batch=0;batch<4;batch++){
  await win.page.evaluate(async batch=>{
   const a=mollyEditor;a.settingsManager.set('confirmClose',false);a.settingsManager.set('animationsEnabled',false);window.soakRefs=[];
   for(let i=0;i<3;i++){
    a.addProject('Soak '+batch+'-'+i,'none',64,64,false,i===1?'prefix':'title');let p=a.getActiveProject();await p.prefixLoadPromise;window.soakRefs.push(new WeakRef(p));
    if(p.type==='title'){
     const c=Object.assign(document.createElement('canvas'),{width:64,height:64}),ctx=c.getContext('2d');ctx.fillStyle=`rgb(${40+batch*30},${80+i*20},130)`;ctx.fillRect(0,0,64,64);const uri=c.toDataURL();
     a.titleEditor.change(data=>{data.resolution=1024;data.text=batch%2?'ПРИВЕТ':'MOLLY';data.appearance={source:'file',image:uri,fileMode:'tileable'};});
     for(let n=0;a.titleEditor.loading&&n<500;n++)await new Promise(r=>setTimeout(r,10));
     if(a.titleEditor.loading)throw Error('Artwork load timed out');
     for(let n=0;n<5;n++){a.titleEditor.change(data=>{data.yaw=n*5;});a.history.undo();a.history.redo();}
     const out=a.titleEditor.renderer.render(p.titleData);if(!out.canvas.width)throw Error('Empty snapshot');out.canvas.width=out.canvas.height=1;
    }
    if(!await a.closeProject(p.id))throw Error('Generated document could not close');p=null;
   }
  },batch);
  await settle(win);await win.cdp.send('HeapProfiler.collectGarbage');await win.cdp.send('HeapProfiler.collectGarbage');
  const retained=await win.page.evaluate(()=>window.soakRefs.filter(ref=>ref.deref()).map(ref=>ref.deref().name));
  if(retained.length)throw Error('Closed generated documents remain reachable: '+retained.join(', '));
  const cache=await win.page.evaluate(()=>{const r=mollyEditor.titleEditor.renderer;return {custom:[...r.images.keys()].some(key=>key.startsWith('data:')),textures:r.textures.size,mesh:!!r.mesh};});
  if(cache.custom||cache.textures||cache.mesh)throw Error('Closing the final title retained uploaded artwork or scene resources');
  samples.push(await win.cdp.send('Runtime.getHeapUsage'));
 }
 if(samples.at(-1).usedSize-samples[0].usedSize>16*1024*1024)throw Error('Generated editor retained heap grows between batches');
 if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));
 const result={passed:true,documents:12,batches:4,samples};await fs.writeFile(path.join(root,'.test-output/editor-soak.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(e){console.error(e);process.exitCode=1;}finally{clearTimeout(timer);win?.destroy();app.exit(process.exitCode||0);}})();
