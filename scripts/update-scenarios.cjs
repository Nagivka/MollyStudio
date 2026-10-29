const fs=require('node:fs/promises');
const path=require('node:path');
const {app,root,ready,makeWindow,settle,evaluateMain,command}=require('./lib/electron-harness.cjs');
(async()=>{
    const checks=[],expect=(value,message)=>{if(!value)throw Error(message);checks.push(message);console.log('PASS '+message);};
    const watchdog=setTimeout(()=>{console.error('Update scenarios timed out');app.exit(1);},120000);
    let main,settings;
    try{
        await ready();main=makeWindow();await main.loadFile(path.join(root,'src/renderer/index.html'));main.page.setDefaultTimeout(15000);
        const unsupported=await command('update-status');expect(!unsupported.supported,'Development sessions never contact the update server automatically');
        await command('test-control',{operation:'update-fixture'});
        settings=makeWindow(960,760,{label:'settings'});await settings.loadFile(path.join(root,'src/renderer/settings.html'),{query:{tab:'about'}});settings.page.setDefaultTimeout(15000);await settle(settings);
        await settings.page.locator('[data-update="check"]').click();
        await settings.page.waitForFunction(()=>document.querySelector('.update-status')?.textContent.includes('Доступна версия 1.4.2'));
        await main.page.waitForFunction(()=>document.querySelector('.update-banner')&&!document.querySelector('.update-banner').hidden);
        expect(true,'Native NSIS updater parses the signed local release and both windows display availability');
        const themes=['dark','light','minecraft','light-minecraft'];
        for(const theme of themes){
            await settings.page.locator('[data-tab="appearance"]').click();await settings.page.locator(`[data-theme="${theme}"].settings-theme-card`).click();
            await settings.page.locator('[data-tab="about"]').click();
            for(const [width,height] of [[760,560],[1280,800]]){
                settings.setContentSize(width,height);await settle(settings);
                const fit=await settings.page.evaluate(()=>{
                    const area=document.querySelector('.update-panel');
                    return document.documentElement.scrollWidth<=innerWidth+1&&area.scrollWidth<=area.clientWidth+1&&
                        [...area.querySelectorAll('button:not([hidden])')].every(button=>button.getBoundingClientRect().width>0);
                });expect(fit,`Update settings fit ${theme} at ${width}×${height}`);
            }
        }
        await evaluateMain(()=>{globalThis.__mollyTestRuntime.updateFixture.failNextDownload=true;});
        await settings.page.locator('[data-update="download"]').click();
        await settings.page.waitForFunction(()=>document.querySelector('.update-status')?.textContent.includes('Недостаточно места')&&!document.querySelector('[data-update="download"]').disabled);
        expect(true,'Disk-space failure is explained and the download button becomes available for retry');
        await settings.page.locator('[data-update="download"]').click();
        await settings.page.waitForFunction(()=>document.querySelector('[data-update="install"]')&&!document.querySelector('[data-update="install"]').hidden);
        expect((await command('update-status')).status==='downloaded','Real electron-updater downloads and validates the installer from local HTTP without executing it');
        const requests=await evaluateMain(()=>globalThis.__mollyTestRuntime.updateFixture.requests);
        expect(requests.includes('latest.yml')&&requests.some(name=>name.endsWith('-setup.exe')),'The installed NSIS provider performs real metadata and executable requests');
        await main.page.goto('molly://app/editor.html?new=true&type=canvas&width=32&height=32&name=Update%20recovery');
        await main.page.waitForFunction(()=>!!window.mollyEditor?.projectManager);
        await main.page.evaluate(()=>{
            const editor=window.mollyEditor;editor.settingsManager.set('confirmClose',true);
            const layer=editor.layerManager.addLayer('Preserve on update');layer.ctx.fillStyle='#123456';layer.ctx.fillRect(2,2,4,4);layer.invalidateSource();editor.bus.emit('CANVAS_UPDATED');
        });
        await settings.page.locator('[data-update="install"]').click();
        for(let i=0;i<100;i++){
            if(await evaluateMain(()=>globalThis.__mollyTestRuntime.updateFixture.confirmations===1))break;
            if(i===99)throw Error('Close confirmation was not shown');await new Promise(resolve=>setTimeout(resolve,30));
        }
        await main.page.waitForFunction(()=>!document.body.inert&&!window.mollyEditor.documentTasks.closing);
        await settings.page.waitForFunction(()=>!document.querySelector('[data-update="install"]').hidden&&!document.querySelector('[data-update="install"]').disabled);
        expect(await evaluateMain(()=>globalThis.__mollyTestRuntime.updateFixture.installed===0&&globalThis.__mollyTestRuntime.updateFixture.confirmations===1),'Cancelling the real close confirmation prevents installation and restores the editor');
        expect(true,'Cancelling installation re-enables the install button in the actual settings window');
        const drafts=await main.page.evaluate(async()=>Promise.all((await window.desktopAPI.listRecoveryDrafts()).map(item=>window.desktopAPI.readRecoveryDraft(item.draftId))));
        expect(drafts.some(d=>d.project.layers.some(layer=>layer.name==='Preserve on update')),'Edited pixels are durably recovered before the update confirmation');
        await main.page.evaluate(()=>{window.failUpdateFlush=window.desktopAPI.onFlushRecoveryDrafts(()=>false);});
        await command('update-install');
        await main.page.waitForFunction(()=>!document.body.inert&&!window.mollyEditor.documentTasks.closing);
        await settings.page.waitForFunction(()=>!document.querySelector('[data-update="install"]').hidden);
        expect(await evaluateMain(()=>globalThis.__mollyTestRuntime.updateFixture.installed===0),'A failed recovery flush blocks installation');
        await main.page.evaluate(()=>window.failUpdateFlush());
        await evaluateMain(()=>{globalThis.__mollyTestRuntime.updateFixture.confirmResponse=1;});
        const closed=main.page.waitForEvent('close');await command('update-install');await closed;
        for(let i=0;i<100;i++){
            if(await evaluateMain(()=>globalThis.__mollyTestRuntime.updateFixture.installed===1))break;
            if(i===99)throw Error('Approved update did not reach inert installer');await new Promise(resolve=>setTimeout(resolve,20));
        }
        expect(true,'Approved installation starts only after the real editor closes and pending native writes finish');
        if(main.__testErrors.length||settings.__testErrors.length)throw Error([...main.__testErrors,...settings.__testErrors].join('\n'));
        await fs.writeFile(path.join(root,'.test-output/update-scenarios.json'),JSON.stringify({passed:checks.length,checks},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
    }catch(error){console.error(error);process.exitCode=1;}
    finally{clearTimeout(watchdog);await evaluateMain(()=>{globalThis.__mollyTestRuntime?.updateFixture?.server.close();}).catch(()=>{});app.exit(process.exitCode||0);}
})();
