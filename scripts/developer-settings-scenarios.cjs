const path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');
(async()=>{let win,home;let checks=0;const timer=setTimeout(()=>app.exit(1),90000);const expect=(ok,label)=>{if(!ok)throw Error(label);checks++;};try{
await ready();home=makeWindow();await home.loadFile(path.join(root,'src/renderer/index.html'));
win=makeWindow(960,760,{label:'settings'});await win.loadFile(path.join(root,'src/renderer/settings.html'),{query:{tab:'developer'}});await settle(win);
expect(await win.page.locator('[data-tab="developer"]').count()===0,'Locked tab cannot be opened from a URL');
const version=win.page.locator('[data-about-version]');await version.waitFor();
expect(await win.page.locator('[data-about-action="diagnostics"]').count()===0,'About has no diagnostics action');
expect(await version.evaluate(node=>node.tagName==='DD'&&!node.hasAttribute('role')&&getComputedStyle(node).cursor==='text'),'Version keeps its ordinary text appearance');
for(let i=0;i<6;i++)await version.click();
expect(await win.page.locator('[data-tab="developer"]').count()===0,'Six taps do not unlock');
await version.click();expect(await win.page.locator('[data-tab="developer"]').count()===1,'Seventh tap unlocks one tab');
await win.page.locator('[data-tab="developer"]').click();
expect(await win.page.locator('[data-developer-quality],[data-developer-setting="animationsEnabled"]').count()===0,'Ordinary settings are not duplicated');
await win.page.locator('label:has([data-developer-setting="developerPerformance"])').click();
await win.page.waitForFunction(()=>document.querySelector('.developer-performance'));
expect(await win.page.locator('.developer-performance').count()===1,'Frame monitor starts');
await win.page.locator('label:has([data-developer-setting="developerWeatherBounds"])').click();
expect(await win.page.evaluate(()=>document.documentElement.classList.contains('developer-weather-bounds')),'Weather debugger activates');
await win.page.selectOption('[data-developer-holiday]','authorBirthday');
await home.page.waitForFunction(()=>document.querySelector('.seasonal-decoration')?.dataset.season==='authorBirthday');
expect(true,'Holiday simulation synchronizes to the actual launcher');
await win.page.locator('label:has([data-developer-setting="developerLayoutBounds"])').click();
expect(await win.page.evaluate(()=>document.documentElement.classList.contains('developer-layout-bounds')),'Layout debugging applies');
await win.page.reload();await settle(win);expect(await win.page.locator('[data-tab="developer"]').count()===1,'Unlock persists after reload');
await win.page.locator('[data-tab="developer"]').click();
for(const theme of ['dark','light','minecraft','light-minecraft']){
await win.page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
expect(await win.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Developer panel fits '+theme);
}
await win.page.locator('[data-developer-action="hide"]').click();
expect(await win.page.locator('[data-tab="developer"]').count()===0,'Hide removes developer tab');
expect(!await win.page.evaluate(()=>document.documentElement.classList.contains('developer-layout-bounds')),'Hide disables debugging');
expect(await win.page.locator('.developer-performance').count()===0,'Hide stops the frame monitor');
expect(!await win.page.evaluate(()=>document.documentElement.classList.contains('developer-weather-bounds')),'Hide stops weather debugging');
await win.page.reload();await settle(win);expect(await win.page.locator('[data-tab="developer"]').count()===0,'Hidden tab stays locked');
if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));console.log(JSON.stringify({passed:true,checks}));
}catch(error){console.error(error);process.exitCode=1;}finally{clearTimeout(timer);win?.destroy();home?.destroy();app.exit(process.exitCode||0);}})();
