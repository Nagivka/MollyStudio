const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');
(async()=>{let win;const results=[];try{
 await ready();win=makeWindow(1440,1000);await win.loadFile(path.join(root,'src/renderer/index.html'));await win.showInactive();
 await win.page.evaluate(async()=>{
  const {default:Settings}=await import(new URL('js/core/SettingsManager.js',location.href));window.glassSettings=new Settings();glassSettings.set('animationsEnabled',false);
  const {writeRecoveryDraft}=await import(new URL('js/core/RecoveryDraftStore.mjs',location.href));
  const canvas=document.createElement('canvas');canvas.width=canvas.height=32;const ctx=canvas.getContext('2d');
  for(let i=0;i<6;i++){
   ctx.clearRect(0,0,32,32);ctx.fillStyle=['#c79e45','#bf619b','#4196a8','#5eaa6c','#8c7bca','#b5784f'][i];ctx.fillRect(3,3,26,26);ctx.clearRect(6,6,20,20);ctx.fillRect(10,10,12,12);
   await writeRecoveryDraft(localStorage,'glass-card-'+i,{mollyVersion:2,type:'canvas',name:['Золото','Ранг','Магазин','Меню','Префикс','Кнопки'][i],config:{width:32,height:32},layers:[{id:'layer',name:'Art',width:32,height:32,visible:true,opacity:1,dataUrl:canvas.toDataURL()}]});
  }
  window.dispatchEvent(new StorageEvent('storage',{key:'molly_recent'}));
 });
 await win.page.waitForFunction(()=>document.querySelectorAll('.m3-recent-card[data-preview="ready"]').length===6);
 const output=path.join(root,'.test-output/liquid-glass/launcher');await fs.mkdir(output,{recursive:true});
 for(const theme of ['dark','light','minecraft','light-minecraft'])for(const transparency of ['no-preference','reduce']){
  await win.cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:transparency},{name:'prefers-contrast',value:'no-preference'}]});
  await win.page.evaluate(theme=>{glassSettings.set('theme',theme);glassSettings.set('liquidGlassEnabled',true);},theme);await settle(win);
  const state=await win.page.evaluate(()=>{
   const panel=getComputedStyle(document.querySelector('.launcher-recent-panel')),card=getComputedStyle(document.querySelector('.m3-recent-card'));
   return {sheen:getComputedStyle(document.documentElement).getPropertyValue('--glass-sheen'),cardStyle:document.querySelector('.m3-recent-card').getAttribute('style'),panelBackground:panel.backgroundColor,panelImage:panel.backgroundImage,panelShadow:panel.boxShadow,panelFilter:panel.backdropFilter,cardImage:card.backgroundImage,cardShadow:card.boxShadow,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  if(!theme.includes('minecraft')){
   if(state.panelBackground!=='rgba(0, 0, 0, 0)'||state.panelImage!=='none'||state.panelShadow!=='none'||state.panelFilter!=='none')throw Error('Recent projects have a large glass backplate: '+JSON.stringify(state));
   if(!state.cardImage.includes('gradient')||state.cardShadow==='none')throw Error('Individual card lacks visible glass finish: '+JSON.stringify({theme,transparency,...state}));
  }
  if(state.overflow)throw Error('Launcher overflow');
  results.push({theme,transparency,state});
  if(!theme.includes('minecraft'))await fs.writeFile(path.join(output,theme+'-'+transparency+'.png'),(await win.webContents.capturePage()).toPNG());
 }
 await win.page.evaluate(()=>{glassSettings.set('theme','dark');glassSettings.set('liquidGlassEnabled',false);});await settle(win);
 if(await win.page.locator('.m3-recent-card').first().evaluate(node=>getComputedStyle(node).backgroundImage)!=='none')throw Error('Glass finish persists after disabling');
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,cases:results.length,results},null,2));console.log(JSON.stringify({passed:true,cases:results.length}));
}catch(error){console.error(error);process.exitCode=1;}finally{win?.destroy();app.exit(process.exitCode||0);}})();
