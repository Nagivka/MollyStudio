const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,ready,makeWindow,settle,command}=require('./lib/electron-harness.cjs');
(async()=>{let win,settings;try{
    await ready();win=makeWindow(1280,800);await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'canvas',width:'32',height:'32',name:'DO_NOT_LEAK_PROJECT_NAME'}});
    const checks=await win.page.evaluate(async()=>{
        const app=window.mollyEditor,checks=[],expect=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
        expect(app.commands.has('file-save')&&app.commands.has('tool:brush'),'Menu and keyboard commands share one registry');
        app.menuBar.handleAction('tool:brush');expect(app.tools.currentToolId==='brush','Registry dispatch selects the actual drawing tool');
        app.documentTasks.closing=true;expect(app.commands.execute('tool:eraser')===false&&app.tools.currentToolId==='brush','Closing blocks queued editor commands');app.documentTasks.closing=false;
        await app.projectManager.deserializeProject({name:'legacy',width:16,height:24,layers:[]});expect(app.config.width===16&&app.config.height===24,'Legacy MLST migrates before document installation');
        const before=JSON.stringify(app.projectManager.serializeProject());app.layerManager.addLayer('fixture');const layer=app.layerManager.getActiveLayer();layer.ctx.fillRect(0,0,4,4);layer.invalidateSource();
        app.menuBar.handleAction('layer-duplicate');const count=app.layerManager.layers.length;app.menuBar.handleAction('edit-undo');expect(app.layerManager.layers.length===count-1,'Registry actions preserve the native undo stack');
        const {collectDiagnostics}=await import(new URL('js/core/Diagnostics.mjs',location.href));const report=JSON.stringify(await collectDiagnostics());expect(!report.includes('DO_NOT_LEAK_PROJECT_NAME')&&!report.includes('data:image')&&!report.includes('filePath'),'Local report excludes document content and file paths');
        return checks;
    });
    settings=makeWindow(1000,760,{label:'settings'});await settings.loadFile(path.join(root,'src/renderer/settings.html'),{query:{tab:'about'}});await settle(settings);
    await settings.page.click('[data-about-action=diagnostics]');await settings.page.waitForFunction(()=>document.querySelector('.diagnostics-dialog textarea')?.value.includes('MollyStudio diagnostics'));
    const report=await settings.page.locator('.diagnostics-dialog textarea').inputValue();if(!JSON.parse(report).windows.some(w=>w.window==='editor.html'))throw Error('Settings report did not include the running editor');checks.push('Settings previews a report with measurements from the open editor');
    await settings.page.click('[data-diagnostics=save]');await settings.page.waitForFunction(()=>document.querySelector('.diagnostics-dialog output').textContent.includes('сохранён'));checks.push('The previewed diagnostic report saves through the native file dialog');
    await fs.writeFile(path.join(root,'.test-output/diagnostics-preview.png'),(await settings.webContents.capturePage()).toPNG());
    for(const window of [win,settings])if(window.__testErrors.length)throw Error(window.__testErrors.join('\n'));
    await fs.writeFile(path.join(root,'.test-output/architecture-scenarios.json'),JSON.stringify({passed:checks.length,checks},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
}catch(error){console.error(error);process.exitCode=1;}finally{win?.destroy();settings?.destroy();app.exit(process.exitCode||0);}})();
