const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');
(async()=>{let win;const checks=[],timer=setTimeout(()=>app.exit(1),180000);try{
    await ready();win=makeWindow(1280,900);await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'title'}});await settle(win);
    await win.page.evaluate(async()=>{await mollyEditor.getActiveProject().prefixLoadPromise;mollyEditor.titleEditor.setTab('material');});
    for(const text of ['MOLLY','МОЛЛИ']){
        await win.page.evaluate(text=>{mollyEditor.titleEditor.change(d=>{d.text=text;});},text);await settle(win);
        await win.page.locator('[data-title-design-gallery]').click();
        await win.page.waitForFunction(()=>document.querySelector('.title-design-gallery [role="status"]')?.textContent.includes('оформлений'),null,{timeout:60000});
        const result=await win.page.evaluate(async()=>{
            const {TITLE_DESIGNS}=await import(new URL('js/core/TitleDesignPresets.mjs',location.href)),{titleMaterialCatalog}=await import(new URL('js/core/TitleAppearance.mjs',location.href)),{titleRowSettings}=await import(new URL('js/core/TitleDocument.mjs',location.href));
            const e=mollyEditor.titleEditor,p=e.project(),settings=titleRowSettings(p.titleData,e.currentRow),expected=TITLE_DESIGNS.filter(p=>titleMaterialCatalog(settings.font).textures.some(t=>t.id===p.texture||t.sourceId===p.texture)).length;
            const buttons=[...document.querySelectorAll('[data-title-design]')];if(buttons.length!==expected||buttons.some(b=>b.disabled))throw Error('Compatible title designs did not render');
            const hashes=new Set(buttons.map(b=>{const c=b.querySelector('canvas'),pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;if(!pixels.some((v,i)=>i%4===3&&v))throw Error('Empty design preview');return c.toDataURL();}));
            if(hashes.size<18)throw Error('Title design previews are duplicates');return {count:buttons.length};
        });checks.push(text+': '+result.count+' real, distinct compatible 3D previews');
        await win.page.evaluate(()=>{const s=document.querySelector('.title-design-gallery input');s.value='Аметист';s.dispatchEvent(new Event('input'));if([...document.querySelectorAll('[data-title-design]')].filter(b=>!b.hidden).length!==1)throw Error('Design search failed');mollyEditor.history.clear();});
        await win.page.locator('[data-title-design="6"]').click();await settle(win);
        await win.page.evaluate(()=>{const e=mollyEditor.titleEditor,p=e.project();if(p.titleData.rows[e.currentRow].top!=='#EEDBFF')throw Error('Design applied to the wrong row');if(!mollyEditor.history.undo())throw Error('Design cannot be undone');});
        checks.push(text+': search, row apply and undo');
    }
    const {inspectInterfaceGeometry}=await import('./lib/interface-geometry.mjs');
    for(const theme of ['dark','light','minecraft','light-minecraft']){
        await win.page.evaluate(theme=>{mollyEditor.settingsManager.set('theme',theme);mollyEditor.settingsManager.set('animationsEnabled',true);mollyEditor.titleEditor.setTab('settings');mollyEditor.titleEditor.setTab('material');},theme);
        const motion=await win.page.evaluate(()=>getComputedStyle(document.querySelector('.title-material-panel')).animationName);
        if(motion.includes('ui-section-reveal')===theme.includes('minecraft'))throw Error('New motion was not scoped to standard themes');
        await win.page.locator('[data-title-design-gallery]').click();await settle(win);
        await win.page.waitForFunction(()=>document.querySelector('.title-design-gallery [role="status"]')?.textContent.includes('оформлений'),null,{timeout:60000});
        await win.page.evaluate(async()=>{await Promise.allSettled(document.querySelector('.title-design-gallery').getAnimations({subtree:true}).map(a=>a.finished));});
        const geometry=await win.page.evaluate(inspectInterfaceGeometry);if(geometry.rootOverflow||geometry.overlaps.length||geometry.dialogsOutside.length)throw Error('Design gallery layout failed in '+theme);
        await fs.mkdir(path.join(root,'.test-output/new-designs'),{recursive:true});await fs.writeFile(path.join(root,'.test-output/new-designs',theme+'.png'),(await win.webContents.capturePage()).toPNG());
        await win.page.evaluate(()=>document.querySelector('.title-design-gallery').close());await settle(win);
    }checks.push('New motion excludes both Minecraft themes; gallery fits four main themes');
    await win.page.evaluate(()=>{mollyEditor.settingsManager.set('theme','dark');mollyEditor.settingsManager.set('animationsEnabled',false);if(getComputedStyle(document.querySelector('.title-material-panel')).animationName!=='none')throw Error('Disabled motion still runs');});
    await win.page.evaluate(()=>mollyEditor.settingsManager.set('animationsEnabled',true));
    await win.cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await win.page.evaluate(()=>{if(getComputedStyle(document.querySelector('.title-material-panel')).animationName!=='none')throw Error('Reduced motion still runs');});
    checks.push('App preference and system reduced motion suppress new animations');
    assert.deepEqual(win.__testErrors,[]);await fs.writeFile(path.join(root,'.test-output/new-designs/report.json'),JSON.stringify({passed:true,checks},null,2));console.log(JSON.stringify({passed:true,checks}));
}catch(error){console.error(error);process.exitCode=1;}finally{clearTimeout(timer);win?.destroy();app.exit(process.exitCode||0);}})();
