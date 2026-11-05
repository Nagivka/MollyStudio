const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');
(async()=>{let win,generator,checks=0;const expect=(ok,label)=>{if(!ok)throw Error(label);checks++;},timer=setTimeout(()=>app.exit(1),90000);try{
await ready();win=makeWindow(1000,850);await win.loadFile(path.join(root,'src/renderer/index.html'));await settle(win);
const logo=win.page.locator('.launcher-hero-logo');
await logo.click();expect(await win.page.locator('.studio-basement').count()===0,'Ordinary clicks do not open basement');
for(let i=0;i<6;i++)await logo.click({modifiers:['Shift']});
expect(await win.page.locator('.studio-basement').count()===0,'Six secret clicks do not open basement');
await logo.click({modifiers:['Shift']});expect(await win.page.locator('.studio-basement[open]').count()===1,'Seventh Shift-click opens basement');
await win.page.locator('[data-basement="note"]').click();expect(await win.page.locator('[data-basement-title]').textContent()==='Записка','Desk note works');
await win.page.locator('[data-basement="sketch"]').click();expect(await win.page.locator('[data-basement-title]').textContent()==='Наброски','Wall art works');
await win.page.locator('[data-basement="chest"]').click();expect(await win.page.locator('.basement-reward:not([hidden])').count()===1,'Chest reveals reward');
expect(await win.page.locator('.basement-swatches button').count()===8,'Eight secret colors available');
generator=makeWindow(1100,800,{label:'buttons'});await generator.loadFile(path.join(root,'src/renderer/buttons.html'));await settle(generator);
expect(await generator.page.locator('#paletteSelect option[value="basement"]').count()===0,'Reward is hidden before unlocking');
await win.page.locator('[data-basement-add]').click();
expect(await win.page.locator('[data-basement-add]').isDisabled(),'Adding palette disables duplicate rewards');
expect(await win.page.evaluate(async()=>{const {Palettes,PaletteOptions}=await import(new URL('js/utils/Palettes.js',location.href));return Palettes.basement?.length===8&&PaletteOptions.filter(([id])=>id==='basement').length===1;}),'Reward is in the shared palette registry');
await generator.page.waitForFunction(()=>document.querySelector('#paletteSelect option[value="basement"]'));
await generator.page.locator('#button-generator-tab-color').click();
await generator.page.selectOption('#paletteSelect','basement');
expect(await generator.page.locator('#paletteSelect').inputValue()==='basement','An already open generator receives and selects the secret palette');
for(const theme of ['dark','light','minecraft','light-minecraft']){
await win.page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
for(const [width,height]of [[1000,850],[800,600]]){win.setContentSize(width,height);await settle(win);expect(await win.page.evaluate(()=>{const d=document.querySelector('.studio-basement'),r=d.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&d.scrollWidth<=d.clientWidth+1;}),'Room fits '+theme+' '+width);}
}
await fs.mkdir(path.join(root,'.test-output/basement'),{recursive:true});await fs.writeFile(path.join(root,'.test-output/basement/room.png'),(await win.webContents.capturePage()).toPNG());
await win.page.keyboard.press('Escape');await win.page.locator('.studio-basement').waitFor({state:'detached'});checks++;
expect(await logo.evaluate(node=>document.activeElement===node),'Focus returns to logo');
for(let i=0;i<7;i++)await logo.click({modifiers:['Shift']});expect(await win.page.locator('.studio-basement').count()===1,'Secret can be reopened');
expect(await win.page.locator('[data-basement-add]').isDisabled(),'Reopening cannot add duplicate palette');
await win.page.locator('[data-basement-close]').click();await win.page.locator('.studio-basement').waitFor({state:'detached'});checks++;
await win.page.reload();await settle(win);
expect(await win.page.evaluate(async()=>{const {PaletteOptions}=await import(new URL('js/utils/Palettes.js',location.href));return PaletteOptions.filter(([id])=>id==='basement').length===1;}),'Secret palette survives a reload');
if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));console.log(JSON.stringify({passed:true,checks}));
}catch(error){console.error(error);process.exitCode=1;}finally{clearTimeout(timer);generator?.destroy();win?.destroy();app.exit(process.exitCode||0);}})();
