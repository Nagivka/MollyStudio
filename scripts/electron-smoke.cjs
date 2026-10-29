const fs=require('node:fs/promises');
const path=require('node:path');
const {app,root,profile,ready,makeWindow,settle,command}=require('./lib/electron-harness.cjs');
(async()=>{
    const checks=[];let win,settings;const timer=setTimeout(()=>app.exit(1),90000);
    const expect=(value,message)=>{if(!value)throw Error(message);checks.push(message);};
    try{
        await ready();win=makeWindow();await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'canvas',width:'32',height:'32',name:'Native roundtrip'}});
        const result=await win.webContents.executeJavaScript(`(async()=>{
            const app=window.mollyEditor,api=window.desktopAPI;
            app.settingsManager.set('discordRPC',false);app.settingsManager.set('confirmClose',false);
            const layer=app.layerManager.addLayer('Native pixels');layer.ctx.fillStyle='#12AB34';layer.ctx.fillRect(2,2,5,5);layer.invalidateSource();app.bus.emit('CANVAS_UPDATED');
            const saved=await app.projectManager.saveProjectAs();const project=app.getActiveProject();
            if (!saved || !project?.filePath) throw Error('Native save failed: ' + JSON.stringify({saved,path:project?.filePath,toasts:[...document.querySelectorAll('.md-toast')].map(item=>item.textContent)}));
            const disk=JSON.parse(await api.readFile(project.filePath));
            const info=await api.getAppInfo();
            return {saved,path:project.filePath,hash:project.fileRevision,layers:disk.layers.length,name:disk.name,info,tools:Object.keys(app.tools.tools)};
        })()`);
        expect(result.saved&&result.layers>0&&result.name==='Native roundtrip','Actual Node.js save dialog adapter, atomic write and project read work');
        expect(/^[a-f0-9]{64}$/.test(result.hash),'Node.js returns a SHA-256 revision for saved projects');
        expect(result.info.runtime==='electron'&&result.info.electron&&result.info.chromium,'About information comes from Electron');
        expect(result.tools.includes('move')&&result.tools.includes('marquee')&&result.tools.includes('text'),'Editor instruments initialize in Chromium');
        await fs.writeFile(result.path,JSON.stringify({name:'External modification',layers:[]}));
        const conflict=await win.webContents.executeJavaScript(`(async()=>{try{await window.desktopAPI.writeProjectFile(${JSON.stringify(result.path)},'{}',${JSON.stringify(result.hash)});return false;}catch(error){return error.message.includes('FILE_CHANGED:')||error.message.includes('проект');}})()`);
        expect(conflict,'Conflicting writes cannot silently replace an externally modified file');
        const fixture={mollyVersion:2,name:'Проект из Проводника',type:'canvas',config:{width:16,height:16},layers:[]};
        const file=path.join(profile,'проверка с пробелами.MLST');await fs.writeFile(file,JSON.stringify(fixture));
        await command('test-control',{operation:'open-project',path:file});await settle(win);
        await win.page.waitForFunction(()=>window.mollyEditor?.getActiveProject()?.name==='Проект из Проводника');
        expect(true,'Native file-open queue delivers a Unicode path into the existing editor');
        const count=await win.webContents.executeJavaScript('window.mollyEditor.projects.length');
        await command('test-control',{operation:'open-project',path:file});await settle(win);
        expect(await win.webContents.executeJavaScript('window.mollyEditor.projects.length')===count,'Opening an already open .mlst focuses its tab without duplicating it');
        expect((await command('project-open-pending')).length===0,'Handled file-open requests are acknowledged');
        await win.loadFile(path.join(root,'src/renderer/index.html'));await command('test-control',{operation:'open-project',path:file});
        await win.page.waitForFunction(()=>window.mollyEditor?.getActiveProject()?.name==='Проект из Проводника');
        expect(true,'The launcher transfers pending requests across editor navigation');
        settings=makeWindow(960,760);await settings.loadFile(path.join(root,'src/renderer/settings.html'));await settle(settings);
        expect(await settings.webContents.executeJavaScript("document.querySelectorAll('.settings-theme-card').length")===12,'Settings load ten standard themes and two Minecraft themes in a second Chromium window');
        await settings.webContents.executeJavaScript("document.querySelector('[data-theme=light]').click()");
        await win.page.waitForFunction(()=>document.documentElement.dataset.theme==='light',{},{timeout:5000});
        expect(await win.webContents.executeJavaScript("document.documentElement.dataset.theme==='light'"),'Settings broadcasts update the existing editor');
        if(win.__testErrors.length||settings.__testErrors.length)throw Error([...win.__testErrors,...settings.__testErrors].join('\n'));
        await fs.writeFile(path.join(root,'.test-output/electron-smoke.json'),JSON.stringify({passed:checks.length,checks},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
    }catch(error){console.error(error);if(win?.__testErrors?.length)console.error(win.__testErrors);process.exitCode=1;}finally{clearTimeout(timer);app.exit(process.exitCode||0);}
})();
