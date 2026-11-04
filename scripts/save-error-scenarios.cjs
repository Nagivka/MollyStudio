const fs = require('node:fs/promises');
const path = require('node:path');
const {app, root, ready, makeWindow, settle, evaluateMain} = require('./lib/electron-harness.cjs');

(async () => {
    let win;
    const timer = setTimeout(() => app.exit(1), 90000), checks = [];
    try {
        await ready(); win = makeWindow();
        await win.loadFile(path.join(root, 'src/renderer/editor.html'), {query: {new: 'true', type: 'canvas', width: '32', height: '32', name: 'Origin'}});
        await win.webContents.executeJavaScript(`(() => {
            const app=window.mollyEditor;app.settingsManager.set('language','en');app.settingsManager.set('confirmClose',false);
            window.saveFailureProject=app.activeProjectId;
            const layer=app.layerManager.addLayer('Retained pixels');layer.ctx.fillRect(1,1,4,4);layer.invalidateSource();
            window.saveFailurePixels=JSON.stringify(app.projectManager.serializeProject().layers);
        })()`);
        await evaluateMain(() => {
            const runtime = globalThis.__mollyTestRuntime;
            runtime.__originalWrite = runtime.files.write;
            runtime.files.write = async () => { throw Error('ENOSPC-fixture'); };
        });
        const saved = await win.webContents.executeJavaScript(`window.mollyEditor.projectManager.saveProjectAs()`);
        if (saved) throw Error('Failed write reported success');
        await settle(win);
        const notice = await win.webContents.executeJavaScript(`(() => {
            const toast=document.querySelector('.toast-with-actions');
            return {text:toast?.textContent,controls:[...toast?.querySelectorAll('button')||[]].map(button=>button.textContent.trim())};
        })()`);
        if (!notice.text?.includes('Origin') || !notice.text.includes('disk space') || notice.controls[0] !== 'Retry save' || notice.controls[1] !== 'Save a separate copy') throw Error('Save failure has no actionable localized recovery');
        checks.push('Disk errors identify the project and provide persistent retry and save-copy actions');
        await fs.writeFile(path.join(root, '.test-output/save-error-en.png'), (await win.webContents.capturePage()).toPNG());
        await evaluateMain(() => {
            const runtime = globalThis.__mollyTestRuntime;
            runtime.files.write = runtime.__originalWrite; delete runtime.__originalWrite;
        });
        await win.webContents.executeJavaScript(`(() => {
            const app=window.mollyEditor;app.addProject('Different project','none',32,32,false,'canvas');
            document.querySelector('.toast-actions button:nth-child(2)').click();
        })()`);
        await win.run(() => win.page.waitForFunction(() => !window.mollyEditor.projectManager.pendingSaves.size && window.mollyEditor.projects.find(project => project.id === window.saveFailureProject)?.filePath));
        const result = await win.webContents.executeJavaScript(`(() => {
            const app=window.mollyEditor,p=app.projects.find(project=>project.id===window.saveFailureProject);
            return {file:p.filePath,active:app.getActiveProject().name,same:JSON.stringify(app.projectManager.serializeProject(p.id).layers)===window.saveFailurePixels,notice:!!document.querySelector('.toast-with-actions')};
        })()`);
        const project = JSON.parse(await fs.readFile(result.file, 'utf8'));
        if (project.name !== 'Origin' || result.active !== 'Different project' || !result.same || result.notice) throw Error('Save-copy action did not preserve the original project context: '+JSON.stringify({...result,name:project.name}));
        checks.push('Save-copy retries the original project after switching tabs, preserving its pixels');
        checks.push('Successful recovery dismisses the error and keeps the newly selected tab active');
        const intact=await fs.readFile(result.file,'utf8');
        await evaluateMain(()=>{
            const runtime=globalThis.__mollyTestRuntime;runtime.__originalWrite=runtime.files.write;runtime.__originalDialog=runtime.testSavePath;runtime.__dialogCount=0;
            runtime.files.write=async()=>{throw Error('EACCES-fixture');};
            runtime.testSavePath=(...args)=>{runtime.__dialogCount++;return runtime.__originalDialog(...args);};
        });
        const quick=await win.page.evaluate(async()=>{
            const app=window.mollyEditor;app.switchProject(window.saveFailureProject);const layer=app.layerManager.addLayer('Unsaved retry');layer.ctx.fillRect(0,0,2,2);layer.invalidateSource();app.bus.emit('CANVAS_UPDATED');
            return app.projectManager.saveProject();
        });
        if(quick||await fs.readFile(result.file,'utf8')!==intact)throw Error('Failed quick save changed the disk file');
        if(await evaluateMain(()=>globalThis.__mollyTestRuntime.__dialogCount)!==0)throw Error('Quick save opened an unrequested save dialog after a permission error');
        checks.push('Failed quick save preserves the file and offers recovery without opening a new dialog');
        await evaluateMain(()=>{const r=globalThis.__mollyTestRuntime;r.files.write=r.__originalWrite;r.testSavePath=r.__originalDialog;delete r.__originalWrite;delete r.__originalDialog;});
        await win.page.click('.toast-actions button:first-child');
        await win.page.waitForFunction(()=>!window.mollyEditor.projectManager.pendingSaves.size&&!window.mollyEditor.projectManager.hasUnsavedChanges(window.saveFailureProject));
        checks.push('Retry writes the pending changes to the original file after permission recovery');
        const beforeDisconnect=await fs.readFile(result.file,'utf8');
        await evaluateMain(()=>{const r=globalThis.__mollyTestRuntime;r.__originalWrite=r.files.write;r.files.write=async()=>{throw Error('ENODEV-fixture');};});
        const disconnected=await win.page.evaluate(async()=>{const a=mollyEditor,layer=a.layerManager.addLayer('Disconnected drive edit');layer.ctx.fillRect(3,3,2,2);layer.invalidateSource();a.bus.emit('CANVAS_UPDATED');const before=JSON.stringify(a.projectManager.serializeProject().layers),saved=await a.projectManager.saveProject();return {saved,intact:JSON.stringify(a.projectManager.serializeProject().layers)===before,message:document.querySelector('.toast-with-actions')?.textContent};});
        if(disconnected.saved||!disconnected.intact||!disconnected.message?.includes('disconnected')||await fs.readFile(result.file,'utf8')!==beforeDisconnect)throw Error('Disconnected drive lost pixels, changed the disk file or lacked a useful error');
        checks.push('Disconnecting a drive preserves unsaved pixels and the previous disk file with a localized recovery message');
        await evaluateMain(()=>{const r=globalThis.__mollyTestRuntime;r.files.write=r.__originalWrite;delete r.__originalWrite;});
        await win.page.click('.toast-actions button:first-child');await win.page.waitForFunction(()=>!mollyEditor.projectManager.pendingSaves.size&&!mollyEditor.projectManager.hasUnsavedChanges(window.saveFailureProject));
        checks.push('Reconnecting the drive permits an ordinary retry without losing the pending edit');
        const unexpected = win.__testErrors.filter(message => !/ENOSPC-fixture|EACCES-fixture|ENODEV-fixture/.test(message));
        if (unexpected.length) throw Error(unexpected.join('\n'));
        await fs.writeFile(path.join(root, '.test-output/save-error-scenarios.json'), JSON.stringify({passed: checks.length, checks}, null, 2));
        console.log(JSON.stringify({passed: checks.length, checks}, null, 2));
    } catch (error) { console.error(error); process.exitCode = 1; }
    finally { clearTimeout(timer); win?.destroy(); app.exit(process.exitCode || 0); }
})();
