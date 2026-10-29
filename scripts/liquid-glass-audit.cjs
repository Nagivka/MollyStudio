const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');
(async()=>{const windows=[],results=[];const timer=setTimeout(()=>app.exit(1),240000);
try{
 const {inspectInterfaceGeometry}=await import('./lib/interface-geometry.mjs');await ready();
 const main=makeWindow(1280,900),settings=makeWindow(1000,700,{label:'settings'}),buttons=makeWindow(1280,900,{label:'buttons'}),project=makeWindow(1000,700,{label:'new-project'});windows.push(main,settings,buttons,project);
 const output=path.join(root,'.test-output/liquid-glass/audit');await fs.mkdir(output,{recursive:true});
 const pages=[{id:'home',win:main,file:'index.html'},{id:'settings',win:settings,file:'settings.html'},{id:'buttons',win:buttons,file:'buttons.html'},{id:'new-project',win:project,file:'new-project.html'},{id:'prefix',win:main,file:'editor.html',query:{new:'true',type:'prefix',name:'Glass audit'}}];
 for(const page of pages){
  const win=page.win;await win.loadFile(path.join(root,'src/renderer',page.file),{query:page.query||{}});
  await win.cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'no-preference'},{name:'prefers-contrast',value:'no-preference'}]});
  await win.page.evaluate(async()=>{const {default:Settings}=await import(new URL('js/core/SettingsManager.js',location.href));window.glassAuditSettings=window.mollyEditor?.settingsManager||new Settings();glassAuditSettings.set('animationsEnabled',false);});
  if(page.id==='settings')await win.page.click('#settings-tab-effects');
  for(const theme of ['dark','light','minecraft','light-minecraft'])for(const zoom of [1,1.5]){
   win.webContents.setZoomFactor(zoom);
   await win.page.evaluate(theme=>{glassAuditSettings.set('theme',theme);glassAuditSettings.set('liquidGlassEnabled',false);},theme);await settle(win);
   const before=await win.page.evaluate(inspectInterfaceGeometry);
   const metrics=()=>win.page.evaluate(()=>[...document.querySelectorAll('button,input,select,textarea')].filter(e=>e.getClientRects().length&&!e.closest('[hidden]')).map(e=>{const r=e.getBoundingClientRect();return [r.width,r.height];}));
   const controls=await metrics();
   await win.page.evaluate(()=>glassAuditSettings.set('liquidGlassEnabled',true));await settle(win);
   const after=await win.page.evaluate(inspectInterfaceGeometry),changed=JSON.stringify(controls)!==JSON.stringify(await metrics());
   const failures=[];
   if(changed)failures.push('control dimensions');
   for(const key of ['overlaps','clipped','overflow','dialogsOutside'])if(after[key].length>before[key].length)failures.push(key);
   if(after.rootOverflow>before.rootOverflow+2)failures.push('rootOverflow');
   results.push({page:page.id,theme,zoom,failures,before,after});
   if(failures.length)throw Error(JSON.stringify({page:page.id,theme,zoom,failures}));
   if(zoom===1&&['dark','light'].includes(theme)){await win.showInactive();await fs.writeFile(path.join(output,page.id+'-'+theme+'.png'),(await win.webContents.capturePage()).toPNG());}
  }
  console.log('Checked glass layout: '+page.id);
 }
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,cases:results.length,results},null,2));console.log(JSON.stringify({passed:true,cases:results.length}));
}catch(error){console.error(error);process.exitCode=1;}finally{clearTimeout(timer);for(const win of windows)win.destroy();app.exit(process.exitCode||0);}})();
