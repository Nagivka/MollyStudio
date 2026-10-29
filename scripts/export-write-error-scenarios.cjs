const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,ready,makeWindow,evaluateMain,settle}=require('./lib/electron-harness.cjs');
(async()=>{let win;try{
    await ready();win=makeWindow();await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'canvas',width:'32',height:'32'}});
    await win.page.evaluate(async()=>{
        const app=window.mollyEditor;app.settingsManager.set('language','en');const layer=app.layerManager.addLayer();layer.ctx.fillRect(2,2,8,8);layer.invalidateSource();
        window.exportBefore=JSON.stringify(app.projectManager.serializeProject());await app.exportPanel.open();
    });
    await evaluateMain(()=>{const r=globalThis.__mollyTestRuntime;r.__write=r.files.write;r.files.write=async()=>{throw Error('EBUSY-fixture');};});
    if(await win.page.evaluate(()=>window.mollyEditor.exportPanel.run()))throw Error('Failed export reported success');
    const state=await win.page.evaluate(()=>{const app=window.mollyEditor;return {same:window.exportBefore===JSON.stringify(app.projectManager.serializeProject()),message:app.exportPanel.get('error').textContent,retry:!app.exportPanel.get('save').disabled,busy:app.exportPanel.busy};});
    if(!state.same||!state.retry||state.busy||!/another (?:application|program)/.test(state.message))throw Error('Export failure does not preserve the document or explain the recovery: '+JSON.stringify(state));
    const {inspectInterfaceGeometry}=await import('./lib/interface-geometry.mjs');
    for(const theme of ['dark','minecraft','light-minecraft'])for(const language of ['ru','en']){
        await win.page.evaluate(({theme,language})=>{const app=window.mollyEditor;app.settingsManager.set('theme',theme);app.settingsManager.set('language',language);},{theme,language});
        win.setContentSize(1000,700);win.webContents.setZoomFactor(1.25);await settle(win);
        const layout=await win.page.evaluate(inspectInterfaceGeometry);
        if(layout.dialogsOutside.length||layout.overlaps.length||layout.clipped.length||layout.overflow.length)throw Error('File error layout overflow in '+theme+' '+language);
    }
    await evaluateMain(()=>{const r=globalThis.__mollyTestRuntime;r.files.write=r.__write;delete r.__write;});
    if(!await win.page.evaluate(()=>window.mollyEditor.exportPanel.run()))throw Error('Export could not retry after recovering file access');
    const unexpected=win.__testErrors.filter(s=>!s.includes('EBUSY-fixture'));if(unexpected.length)throw Error(unexpected.join('\n'));
    const result={passed:4,checks:['Failed PNG write preserves the editable project','A localized file error explains the cause and leaves retry available','File error text fits ordinary and Minecraft themes in both languages at 125%','Export retries successfully after file access is restored']};
    await fs.writeFile(path.join(root,'.test-output/export-write-error-scenarios.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){console.error(error);process.exitCode=1;}finally{win?.destroy();app.exit(process.exitCode||0);}})();
