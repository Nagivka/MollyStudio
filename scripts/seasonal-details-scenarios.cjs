const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');
(async()=>{let home,settings;const checks=[];const expect=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};try{
 await ready();home=makeWindow(1280,850);await home.loadFile(path.join(root,'src/renderer/index.html'));await home.showInactive();
 await home.page.evaluate(async()=>{const {default:Settings}=await import(new URL('js/core/SettingsManager.js',location.href));window.seasonSettings=new Settings();seasonSettings.set('animationsEnabled',false);});
 const output=path.join(root,'.test-output/seasonal');await fs.mkdir(output,{recursive:true});
 for(const [date,season] of [['2026-01-20T12:00:00','winter'],['2026-04-10T12:00:00','spring'],['2026-07-10T12:00:00','summer'],['2026-09-10T12:00:00','autumn'],['2026-10-29T12:00:00','halloween'],['2026-12-24T12:00:00','newyear']]){
  await home.page.clock.setFixedTime(new Date(date));
  for(const theme of ['dark','light','minecraft','light-minecraft']){
   await home.page.evaluate(theme=>seasonSettings.set('theme',theme),theme);await settle(home);
   expect(await home.page.locator('.seasonal-decoration').count()===1,season+'/'+theme+': one decoration');
   expect(await home.page.locator('.seasonal-decoration').getAttribute('data-season')===season,season+'/'+theme+': correct local calendar');
   expect(await home.page.locator('.seasonal-decoration img').count()===(theme.includes('minecraft')?1:0),season+'/'+theme+': matching artwork style');
   if(theme.includes('minecraft'))await home.page.waitForFunction(()=>document.querySelector('.seasonal-decoration img')?.naturalWidth>0);
   const size=await home.page.locator('.seasonal-decoration').evaluate(node=>{
    const box=node.getBoundingClientRect(),image=node.querySelector('img'),title=node.parentElement.getBoundingClientRect();
    return {width:box.width,height:box.height,scale:image?image.getBoundingClientRect().width/image.naturalWidth:null,insideTitle:box.left>=title.left&&box.right<=title.right+1};
   });
   expect(size.width===32&&size.height===32&&size.insideTitle,season+'/'+theme+': consistent ornament size and placement');
   if(theme.includes('minecraft'))expect(Number.isInteger(size.scale)&&size.scale>=2,season+'/'+theme+': crisp integer sprite scaling');
   expect(await home.page.locator('.seasonal-decoration').evaluate(node=>node.getAttribute('aria-hidden')==='true'&&getComputedStyle(node).pointerEvents==='none'),season+'/'+theme+': decoration cannot intercept actions');
   expect(await home.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),season+'/'+theme+': no horizontal overflow');
   if(['halloween','newyear'].includes(season)&&['dark','minecraft'].includes(theme))await fs.writeFile(path.join(output,season+'-'+theme+'.png'),(await home.webContents.capturePage()).toPNG());
  }
 }
 settings=makeWindow(960,760,{label:'settings'});await settings.loadFile(path.join(root,'src/renderer/settings.html'));await settings.page.click('#settings-tab-effects');
 await settings.page.locator('label:has(#setting-seasonal-details) .md-switch-track').click();
 await home.page.waitForFunction(()=>!document.querySelector('.seasonal-decoration'));expect(true,'Opt-out synchronizes across windows');
 await settings.page.reload();await settings.page.click('#settings-tab-effects');expect(!await settings.page.locator('#setting-seasonal-details').isChecked(),'Opt-out survives reload');
 await settings.page.locator('label:has(#setting-seasonal-details) .md-switch-track').click();await home.page.waitForFunction(()=>document.querySelectorAll('.seasonal-decoration').length===1);
 for(const [width,height,zoom] of [[800,650,1],[1280,850,1.25],[1280,850,1.5]]){
  home.setContentSize(width,height);home.webContents.setZoomFactor(zoom);await settle(home);
  expect(await home.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Launcher fits width '+width+' zoom '+zoom);
  expect(await home.page.locator('.seasonal-decoration').evaluate(node=>{const r=node.getBoundingClientRect(),buttons=document.querySelector('.launcher-home-settings').getBoundingClientRect();return r.right<=buttons.left&&r.width===32&&r.height===32;}),'Ornament keeps size and clears settings buttons at zoom '+zoom);
 }
 await settings.page.evaluate(()=>document.documentElement.dataset.theme='minecraft');
 expect(await settings.page.locator('.seasonal-decoration').count()===0,'No seasonal decoration in settings workspace');
 await home.page.clock.setFixedTime(new Date('2026-10-29T12:00:00'));await home.page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 expect(await home.page.locator('.seasonal-decoration').getAttribute('data-season')==='halloween','Focus refreshes changed date without restarting');
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,checks},null,2));console.log(JSON.stringify({passed:true,checks:checks.length}));
}catch(error){console.error(error);process.exitCode=1;}finally{home?.destroy();settings?.destroy();app.exit(process.exitCode||0);}})();
